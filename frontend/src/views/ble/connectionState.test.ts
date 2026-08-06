import assert from "node:assert/strict";
import test from "node:test";
import {
  createBleConnectionState,
  createBleSubscriptions,
  getBleConnectionControls,
  reduceBleConnectionState,
  type BleConnectionState
} from "./connectionState.ts";

const device = { address: "AA:BB:CC:DD:EE:FF", name: "SATELLAI" };

function reduce(
  state: BleConnectionState,
  ...events: Parameters<typeof reduceBleConnectionState>[1][]
): BleConnectionState {
  return events.reduce(reduceBleConnectionState, state);
}

test("startup sync never exposes commands as connected before subscriptions", () => {
  const initial = createBleConnectionState();
  assert.equal(initial.phase, "syncing");
  assert.equal(getBleConnectionControls(initial).busy, true);

  const restored = reduceBleConnectionState(initial, {
    type: "sync_connected",
    device
  });
  assert.equal(restored.phase, "subscribing");
  assert.equal(getBleConnectionControls(restored).disconnectVisible, true);
  assert.equal(restored.subscriptions.app.status, "pending");
});

test("scan distinguishes empty results, ready results, and API failures", () => {
  const initial = reduceBleConnectionState(createBleConnectionState(), {
    type: "sync_idle"
  });
  const scanning = reduceBleConnectionState(initial, { type: "scan_started" });
  assert.equal(scanning.phase, "scanning");
  assert.equal(getBleConnectionControls(scanning).scanLabel, "停止扫描");

  const empty = reduceBleConnectionState(scanning, {
    type: "scan_stopped",
    count: 0
  });
  assert.equal(empty.phase, "scan_empty");
  assert.equal(getBleConnectionControls(empty).connectDisabled, true);

  const ready = reduce(
    initial,
    { type: "scan_started" },
    { type: "scan_updated", count: 2 },
    { type: "scan_stopped", count: 2 }
  );
  assert.equal(ready.phase, "scan_ready");
  assert.equal(getBleConnectionControls(ready).connectDisabled, false);

  const failed = reduceBleConnectionState(scanning, {
    type: "scan_failed",
    error: "adapter unavailable"
  });
  assert.equal(failed.phase, "scan_failed");
  assert.equal(failed.error, "adapter unavailable");
});

test("connect and subscribe phases prevent duplicate connection actions", () => {
  const ready = reduce(
    createBleConnectionState(),
    { type: "sync_idle" },
    { type: "scan_started" },
    { type: "scan_stopped", count: 1 }
  );
  const connecting = reduceBleConnectionState(ready, {
    type: "connect_started",
    device
  });
  assert.equal(connecting.phase, "connecting");
  assert.equal(getBleConnectionControls(connecting).connectDisabled, true);
  assert.equal(getBleConnectionControls(connecting).scanDisabled, true);

  const subscribing = reduceBleConnectionState(connecting, {
    type: "subscribing",
    device
  });
  assert.equal(subscribing.phase, "subscribing");
});

test("subscription failures keep the physical connection in partial mode", () => {
  const subscribing = reduce(
    createBleConnectionState(),
    { type: "sync_connected", device }
  );
  const subscriptions = createBleSubscriptions("ready");
  subscriptions.transport = {
    status: "unsupported",
    error: "transport characteristic not found"
  };
  const partial = reduceBleConnectionState(subscribing, {
    type: "subscriptions_resolved",
    subscriptions
  });
  assert.equal(partial.phase, "connected_partial");
  assert.equal(partial.device?.address, device.address);
  assert.match(partial.error || "", /TRANSPORT/);
  assert.equal(getBleConnectionControls(partial).disconnectVisible, true);
});

test("all subscriptions ready produces the fully connected phase", () => {
  const connected = reduce(
    createBleConnectionState(),
    { type: "sync_connected", device },
    {
      type: "subscriptions_resolved",
      subscriptions: createBleSubscriptions("ready")
    }
  );
  assert.equal(connected.phase, "connected");
  assert.equal(connected.error, undefined);
});

test("failed disconnect reconciles against backend state", () => {
  const connected = reduce(
    createBleConnectionState(),
    { type: "sync_connected", device },
    {
      type: "subscriptions_resolved",
      subscriptions: createBleSubscriptions("ready")
    },
    { type: "disconnect_started" }
  );
  assert.equal(connected.phase, "disconnecting");

  const stillConnected = reduceBleConnectionState(connected, {
    type: "disconnect_failed",
    error: "request failed",
    connected: true
  });
  assert.equal(stillConnected.phase, "connected");
  assert.equal(stillConnected.error, "request failed");

  const actuallyDisconnected = reduceBleConnectionState(connected, {
    type: "disconnect_failed",
    error: "request failed",
    connected: false
  });
  assert.equal(actuallyDisconnected.phase, "idle");
});

test("remote disconnect keeps the last device for manual reconnect", () => {
  const disconnected = reduce(
    createBleConnectionState(),
    { type: "sync_connected", device },
    { type: "disconnected", error: "GATT session unavailable" }
  );
  assert.equal(disconnected.phase, "disconnected");
  assert.equal(disconnected.lastDevice?.address, device.address);
  assert.equal(getBleConnectionControls(disconnected).reconnectVisible, true);

  const reconnecting = reduceBleConnectionState(disconnected, {
    type: "reconnect_started",
    device
  });
  assert.equal(reconnecting.phase, "reconnecting");
  assert.equal(getBleConnectionControls(reconnecting).connectDisabled, true);
});

test("event-stream failures do not change BLE connection phase", () => {
  const connected = reduce(
    createBleConnectionState(),
    { type: "sync_connected", device },
    {
      type: "subscriptions_resolved",
      subscriptions: createBleSubscriptions("ready")
    }
  );
  const reconnecting = reduceBleConnectionState(connected, {
    type: "event_stream_reconnecting"
  });
  assert.equal(reconnecting.phase, "connected");
  assert.equal(reconnecting.eventStream, "reconnecting");

  const open = reduceBleConnectionState(reconnecting, {
    type: "event_stream_open"
  });
  assert.equal(open.phase, "connected");
  assert.equal(open.eventStream, "open");
});

test("a connection failure retains the target and original error", () => {
  const failed = reduce(
    createBleConnectionState(),
    { type: "connect_started", device },
    { type: "connect_failed", error: "connection timeout", device }
  );
  assert.equal(failed.phase, "connect_failed");
  assert.equal(failed.error, "connection timeout");
  assert.equal(failed.lastDevice?.address, device.address);
  assert.equal(getBleConnectionControls(failed).reconnectVisible, true);
});
