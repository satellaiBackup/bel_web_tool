import assert from "node:assert/strict";
import test from "node:test";
import {
  createBleConnectionState,
  createBleSubscriptions,
  getBleConnectionControls,
  getBleSubscriptionProgress,
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

test("subscription progress exposes ready channels without completing optional probes", () => {
  const subscribing = reduce(
    createBleConnectionState(),
    { type: "sync_connected", device }
  );
  const subscriptions = createBleSubscriptions("pending");
  subscriptions.nus = { status: "ready" };
  const updated = reduceBleConnectionState(subscribing, {
    type: "subscriptions_updated",
    subscriptions
  });

  assert.equal(updated.phase, "subscribing");
  assert.equal(updated.subscriptions.nus.status, "ready");
  assert.equal(updated.subscriptions.transport.status, "pending");
});

test("subscription progress follows the real channel order and advances visibly", () => {
  const subscribing = reduce(
    createBleConnectionState(),
    { type: "sync_connected", device }
  );
  const initialProgress = getBleSubscriptionProgress(subscribing);
  assert.deepEqual(
    initialProgress.items.map(item => [item.name, item.statusText]),
    [
      ["nus", "订阅中"],
      ["app", "等待"],
      ["dfu", "等待"],
      ["transport", "等待"]
    ]
  );
  assert.equal(initialProgress.completed, 0);
  assert.equal(initialProgress.percent, 0);

  const subscriptions = createBleSubscriptions("pending");
  subscriptions.nus = { status: "ready" };
  subscriptions.app = { status: "ready" };
  const updated = reduceBleConnectionState(subscribing, {
    type: "subscriptions_updated",
    subscriptions
  });
  const updatedProgress = getBleSubscriptionProgress(updated);
  assert.equal(updatedProgress.activeLabel, "DFU");
  assert.equal(updatedProgress.completed, 2);
  assert.equal(updatedProgress.percent, 50);
  assert.equal(updatedProgress.items[0].statusText, "已就绪");
  assert.equal(updatedProgress.items[1].statusText, "已就绪");
  assert.equal(updatedProgress.items[2].statusText, "订阅中");
});

test("supported channel failures keep the physical connection in partial mode", () => {
  const failures: Array<{
    name: "transport" | "nus" | "app" | "dfu";
    status: "unsupported" | "failed";
    error: string;
  }> = [
    {
      name: "transport",
      status: "unsupported",
      error: "transport characteristic not found"
    },
    { name: "nus", status: "failed", error: "nus subscription failed" },
    { name: "app", status: "failed", error: "app subscription failed" },
    { name: "dfu", status: "failed", error: "dfu subscription failed" }
  ];

  failures.forEach(failure => {
    const subscribing = reduce(
      createBleConnectionState(),
      { type: "sync_connected", device }
    );
    const subscriptions = createBleSubscriptions("ready");
    subscriptions[failure.name] = {
      status: failure.status,
      error: failure.error
    };
    const partial = reduceBleConnectionState(subscribing, {
      type: "subscriptions_resolved",
      subscriptions
    });

    assert.equal(partial.phase, "connected_partial", failure.name);
    assert.equal(partial.device?.address, device.address);
    assert.match(partial.error || "", new RegExp(failure.name, "i"));
    assert.equal(getBleConnectionControls(partial).disconnectVisible, true);
  });
});

test("unsupported NUS degrades the connection capability", () => {
  const subscriptions = createBleSubscriptions("ready");
  subscriptions.nus = {
    status: "unsupported",
    error: "nus characteristic not found"
  };
  const partial = reduce(
    createBleConnectionState(),
    { type: "sync_connected", device },
    { type: "subscriptions_resolved", subscriptions }
  );

  assert.equal(partial.phase, "connected_partial");
  assert.match(partial.error || "", /NUS/);
  assert.equal(partial.subscriptions.nus.status, "unsupported");
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
