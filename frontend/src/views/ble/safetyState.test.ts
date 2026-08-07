import assert from "node:assert/strict";
import test from "node:test";
import { createBleSubscriptions } from "./connectionState.ts";
import {
  appendSanitizedBoundedLog,
  canStartTask,
  createSafetySessionState,
  evaluateSafetyGate,
  getNextTabIndex,
  prepareLogForOutput,
  reduceSafetySessionState,
  sanitizeLogText,
  type SafetySessionState
} from "./safetyState.ts";

function trustedState(): SafetySessionState {
  return {
    ...createSafetySessionState(),
    localService: "ready",
    link: "connected",
    identity: "verified",
    device: {
      key: "session-device",
      model: "model-from-snapshot",
      firmware: "firmware-from-snapshot",
      protocol: "protocol-from-snapshot"
    },
    capabilities: {
      read_status: { state: "available", source: "snapshot" },
      fence_write: { state: "policy_blocked", source: "unknown" }
    },
    stream: {
      state: "fresh",
      recoveryRequired: false,
      sequence: 4,
      droppedCount: 0
    },
    task: { state: "idle" }
  };
}

test("ordinary BLE operations use channel capability without an identity gate", () => {
  const state = {
    ...createSafetySessionState(),
    localService: "ready" as const,
    link: "connected" as const,
    capabilities: {
      app: { state: "available" as const, source: "subscription" as const }
    }
  };
  const decision = evaluateSafetyGate(state, {
    action: "legacy.app_command",
    capability: "app",
    risk: "write_confirm"
  });
  assert.equal(state.identity, "unknown");
  assert.equal(state.stream.recoveryRequired, true);
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "allowed");
});

test("high-risk operations retain the verified identity gate", () => {
  const state = {
    ...createSafetySessionState(),
    localService: "ready" as const,
    link: "connected" as const,
    capabilities: {
      dfu: { state: "available" as const, source: "subscription" as const }
    }
  };
  const decision = evaluateSafetyGate(state, {
    action: "legacy.chooseFile",
    capability: "dfu",
    risk: "destructive_confirm"
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "identity_unknown");
  assert.match(decision.reason, /高风险操作/);
});

test("subscription results become per-channel capabilities with actionable reasons", () => {
  const subscriptions = createBleSubscriptions("ready");
  subscriptions.nus = { status: "unsupported", error: "保留未启用" };
  subscriptions.app = { status: "failed", error: "APP CCC 订阅失败" };
  const state = reduceSafetySessionState(
    {
      ...createSafetySessionState(),
      localService: "ready",
      link: "connected"
    },
    { type: "subscriptions_resolved", subscriptions }
  );

  assert.equal(state.link, "connected");
  assert.equal(state.capabilities.transport.state, "available");
  assert.equal(state.capabilities.nus.state, "unavailable");
  assert.equal(state.capabilities.app.state, "failed");
  assert.equal(state.capabilities.dfu.state, "available");

  const appDecision = evaluateSafetyGate(state, {
    action: "legacy.app_command",
    capability: "app",
    risk: "write_confirm"
  });
  assert.equal(appDecision.allowed, false);
  assert.equal(appDecision.code, "capability_failed");
  assert.match(appDecision.reason, /缺失通道 APP/);

  const dfuDecision = evaluateSafetyGate(state, {
    action: "legacy.file_upload",
    capability: "dfu",
    risk: "write_confirm"
  });
  assert.equal(dfuDecision.allowed, true);
});

test("operations that depend on notifications stop when the event stream is unavailable", () => {
  const state = {
    ...createSafetySessionState(),
    localService: "ready" as const,
    link: "connected" as const,
    capabilities: {
      app: { state: "available" as const, source: "subscription" as const }
    },
    stream: {
      state: "stale" as const,
      recoveryRequired: true,
      droppedCount: 0
    }
  };
  const decision = evaluateSafetyGate(state, {
    action: "legacy.app_command",
    capability: "app",
    risk: "write_confirm"
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "event_stream_untrusted");
  assert.match(decision.reason, /通知事件流不可用/);
});

test("P0-DG-01: missing risk rules remain risk_unknown and hard blocked", () => {
  const decision = evaluateSafetyGate(trustedState(), {
    action: "legacy.unknown_command",
    risk: "risk_unknown"
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "risk_unknown");
});

test("P0-ID-03: capability unknown/checking/failed/unavailable/policy_blocked have distinct reasons", () => {
  const states = [
    "unknown",
    "checking",
    "failed",
    "unavailable",
    "policy_blocked"
  ] as const;
  const decisions = states.map(capabilityState =>
    evaluateSafetyGate(
      {
        ...trustedState(),
        capabilities: {
          candidate: { state: capabilityState, source: "unknown" }
        }
      },
      {
        action: "candidate.read",
        capability: "candidate",
        risk: "safe_read"
      }
    )
  );
  assert.ok(decisions.every(decision => decision.allowed === false));
  assert.equal(
    new Set(decisions.map(decision => decision.reason)).size,
    states.length
  );
});

test("P0-SSE-01/02: high-risk actions remain locked until the stream snapshot is trusted", () => {
  const stale = reduceSafetySessionState(trustedState(), {
    type: "event_stream_reconnecting"
  });
  assert.equal(stale.stream.state, "stale");
  assert.equal(stale.stream.recoveryRequired, true);

  const opened = reduceSafetySessionState(stale, { type: "event_stream_open" });
  assert.equal(opened.stream.state, "snapshot_syncing");
  assert.equal(
    evaluateSafetyGate(opened, {
      action: "read.status",
      capability: "read_status",
      risk: "destructive_confirm"
    }).code,
    "event_stream_untrusted"
  );

  const failed = reduceSafetySessionState(opened, {
    type: "snapshot_failed",
    error: "snapshot unavailable"
  });
  assert.equal(failed.stream.state, "failed");
  assert.equal(failed.stream.recoveryRequired, true);
});

test("P0-SSE-03: sequence gaps and dropped events remain visible and lock the gate", () => {
  const gapped = reduceSafetySessionState(trustedState(), {
    type: "stream_event",
    sequence: 8,
    droppedCount: 2
  });
  assert.equal(gapped.stream.state, "stale");
  assert.equal(gapped.stream.droppedCount, 2);
  assert.match(gapped.stream.diagnostic || "", /断档/);
});

test("P0-SSE-04: device changes clear capability truth and make active task result unknown", () => {
  const active = reduceSafetySessionState(trustedState(), {
    type: "task_started",
    id: "task-1",
    action: "read.status"
  });
  const reconciled = reduceSafetySessionState(active, {
    type: "snapshot_reconciled",
    sessionId: "session-2",
    deviceKey: "another-device",
    model: "model-2",
    firmware: "firmware-2",
    protocol: "protocol-2",
    capabilities: { read_status: true },
    taskState: "idle"
  });
  assert.equal(reconciled.task.state, "unknown_result");
  assert.equal(reconciled.capabilities.fence_write.state, "policy_blocked");
});

test("P0-TSK-01/02/03: tasks are single-flight, accepted is not success, and disconnect is unknown_result", () => {
  const first = reduceSafetySessionState(trustedState(), {
    type: "task_started",
    id: "task-1",
    action: "read.status"
  });
  assert.equal(canStartTask(first), false);
  const duplicate = reduceSafetySessionState(first, {
    type: "task_started",
    id: "task-2",
    action: "read.status"
  });
  assert.equal(duplicate.task.id, "task-1");

  const accepted = reduceSafetySessionState(first, {
    type: "task_accepted",
    id: "task-1"
  });
  assert.equal(accepted.task.state, "accepted");
  assert.notEqual(accepted.task.state, "succeeded");

  const disconnected = reduceSafetySessionState(accepted, {
    type: "disconnected"
  });
  assert.equal(disconnected.task.state, "unknown_result");
  assert.equal(canStartTask(disconnected), false);

  const timedOut = reduceSafetySessionState(first, {
    type: "task_finished",
    id: "task-1",
    outcome: "timed_out"
  });
  assert.equal(timedOut.task.state, "timed_out");
  assert.equal(canStartTask(timedOut), false);
});

test("P0-FEN-01/02: fence writes stay policy_blocked in every session state", () => {
  for (const state of [createSafetySessionState(), trustedState()]) {
    const decision = evaluateSafetyGate(state, {
      action: "fence.write",
      capability: "fence_write",
      risk: "risk_unknown",
      policy: "policy_blocked"
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "policy_blocked");
  }
});

test("P0-LOG-01/03: render, copy and export sanitization removes secrets and masks identifiers", () => {
  const raw = JSON.stringify({
    ac: "LPA:1$smdp.example$secret-code",
    password: "wifi-secret",
    token: "bearer-token",
    body: "private response",
    iccid: "89860012345678901234",
    mac: "AA:BB:CC:DD:EE:FF",
    url: "https://example.test/path?code=secret&token=also-secret"
  });
  for (const output of [sanitizeLogText(raw), prepareLogForOutput(raw)]) {
    assert.doesNotMatch(
      output,
      /secret-code|wifi-secret|bearer-token|private response|also-secret/
    );
    assert.match(output, /8986\*+1234/);
    assert.match(output, /AA:BB:\*\*:\*\*:EE:FF/i);
  }
  const prefixed = sanitizeLogText(
    'RESP: {"token":"prefixed-token","password":"prefixed-password"}'
  );
  assert.doesNotMatch(prefixed, /prefixed-token|prefixed-password/);
});

test("P0-LOG-02: fallback log buffer has explicit entry and byte bounds", () => {
  const result = appendSanitizedBoundedLog(
    "one\ntwo\nthree\n",
    "four\nfive\n",
    3,
    64
  );
  assert.equal(result.truncated, true);
  assert.ok(result.droppedEntries > 0);
  assert.ok(new TextEncoder().encode(result.text).byteLength <= 64);
  assert.doesNotMatch(result.text, /one/);
});

test("P0-A11Y-01: tab arrow, Home and End navigation wraps predictably", () => {
  assert.equal(getNextTabIndex(0, "ArrowRight", 4), 1);
  assert.equal(getNextTabIndex(0, "ArrowLeft", 4), 3);
  assert.equal(getNextTabIndex(2, "Home", 4), 0);
  assert.equal(getNextTabIndex(1, "End", 4), 3);
  assert.equal(getNextTabIndex(1, "Enter", 4), null);
});
