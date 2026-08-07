export type BleConnectionPhase =
  | "syncing"
  | "idle"
  | "scanning"
  | "scan_ready"
  | "scan_empty"
  | "scan_failed"
  | "connecting"
  | "subscribing"
  | "connected"
  | "connected_partial"
  | "disconnecting"
  | "connect_failed"
  | "disconnected"
  | "reconnecting"
  | "backend_unavailable";

export type BleEventStreamState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "failed";

export type BleSubscriptionStatus =
  | "idle"
  | "pending"
  | "ready"
  | "unsupported"
  | "failed";

export type BleSubscriptionName = "transport" | "nus" | "app" | "dfu";

export interface BleDeviceSummary {
  address: string;
  name?: string;
}

export interface BleSubscriptionState {
  status: BleSubscriptionStatus;
  error?: string;
}

export type BleSubscriptions = Record<
  BleSubscriptionName,
  BleSubscriptionState
>;

export interface BleConnectionState {
  phase: BleConnectionPhase;
  eventStream: BleEventStreamState;
  statusText: string;
  error?: string;
  device?: BleDeviceSummary;
  lastDevice?: BleDeviceSummary;
  scanCount: number;
  subscriptions: BleSubscriptions;
  resumePhase?: "subscribing" | "connected" | "connected_partial";
}

export type BleConnectionEvent =
  | { type: "sync_started" }
  | { type: "sync_idle" }
  | { type: "sync_connected"; device: BleDeviceSummary }
  | { type: "backend_unavailable"; error: string }
  | { type: "scan_started" }
  | { type: "scan_updated"; count: number }
  | { type: "scan_stopped"; count: number }
  | { type: "scan_failed"; error: string }
  | { type: "connect_started"; device: BleDeviceSummary }
  | { type: "reconnect_started"; device: BleDeviceSummary }
  | { type: "subscribing"; device: BleDeviceSummary }
  | { type: "subscriptions_resolved"; subscriptions: BleSubscriptions }
  | { type: "connect_failed"; error: string; device?: BleDeviceSummary }
  | { type: "disconnect_started" }
  | { type: "disconnect_failed"; error: string; connected: boolean }
  | { type: "disconnected"; error?: string; device?: BleDeviceSummary }
  | { type: "event_stream_connecting" }
  | { type: "event_stream_open" }
  | { type: "event_stream_reconnecting" }
  | { type: "event_stream_failed" };

export interface BleConnectionControls {
  busy: boolean;
  scanDisabled: boolean;
  scanLabel: "扫描设备" | "停止扫描";
  connectDisabled: boolean;
  disconnectVisible: boolean;
  disconnectDisabled: boolean;
  reconnectVisible: boolean;
  reconnectDisabled: boolean;
  filtersDisabled: boolean;
}

const subscriptionNames: BleSubscriptionName[] = [
  "transport",
  "nus",
  "app",
  "dfu"
];

export function createBleSubscriptions(
  status: BleSubscriptionStatus = "idle"
): BleSubscriptions {
  return {
    transport: { status },
    nus: { status },
    app: { status },
    dfu: { status }
  };
}

export function createBleConnectionState(): BleConnectionState {
  return {
    phase: "syncing",
    eventStream: "connecting",
    statusText: "正在同步设备状态…",
    scanCount: 0,
    subscriptions: createBleSubscriptions()
  };
}

function deviceLabel(device?: BleDeviceSummary): string {
  if (!device) return "设备";
  const name = device.name || "设备";
  const address = device.address.toUpperCase();
  const parts = address.split(":");
  const suffix = parts.length >= 2 ? parts.slice(-2).join(":") : address;
  return suffix ? `${name} · ${suffix}` : name;
}

function isDegradedSubscription(
  name: BleSubscriptionName,
  subscriptions: BleSubscriptions
): boolean {
  const subscription = subscriptions[name];
  return !(
    subscription.status === "ready" ||
    (name === "nus" && subscription.status === "unsupported")
  );
}

function subscriptionFailureSummary(subscriptions: BleSubscriptions): string {
  return subscriptionNames
    .filter(name => isDegradedSubscription(name, subscriptions))
    .map(name => {
      const item = subscriptions[name];
      return `${name.toUpperCase()}: ${item.error || item.status}`;
    })
    .join("；");
}

export function reduceBleConnectionState(
  state: BleConnectionState,
  event: BleConnectionEvent
): BleConnectionState {
  switch (event.type) {
    case "sync_started":
      return {
        ...state,
        phase: "syncing",
        statusText: "正在同步设备状态…",
        error: undefined
      };
    case "sync_idle":
      return {
        ...state,
        phase: "idle",
        statusText: "待连接",
        error: undefined,
        device: undefined,
        subscriptions: createBleSubscriptions()
      };
    case "sync_connected":
      return {
        ...state,
        phase: "subscribing",
        statusText: `已连接，正在初始化通知 · ${deviceLabel(event.device)}`,
        error: undefined,
        device: event.device,
        lastDevice: event.device,
        subscriptions: createBleSubscriptions("pending")
      };
    case "backend_unavailable":
      return {
        ...state,
        phase: "backend_unavailable",
        statusText: "本地 BLE 服务不可用",
        error: event.error
      };
    case "scan_started":
      return {
        ...state,
        phase: "scanning",
        statusText: "扫描中，已发现 0 台设备",
        error: undefined,
        scanCount: 0
      };
    case "scan_updated":
      return {
        ...state,
        phase: "scanning",
        statusText: `扫描中，已发现 ${event.count} 台设备`,
        scanCount: event.count
      };
    case "scan_stopped":
      return {
        ...state,
        phase: event.count > 0 ? "scan_ready" : "scan_empty",
        statusText:
          event.count > 0
            ? `发现 ${event.count} 台设备`
            : "未发现匹配设备",
        error: undefined,
        scanCount: event.count
      };
    case "scan_failed":
      return {
        ...state,
        phase: "scan_failed",
        statusText: "扫描失败",
        error: event.error
      };
    case "connect_started":
      return {
        ...state,
        phase: "connecting",
        statusText: `正在连接 ${deviceLabel(event.device)}…`,
        error: undefined,
        device: event.device,
        lastDevice: event.device
      };
    case "reconnect_started":
      return {
        ...state,
        phase: "reconnecting",
        statusText: `正在重新连接 ${deviceLabel(event.device)}…`,
        error: undefined,
        device: event.device,
        lastDevice: event.device
      };
    case "subscribing":
      return {
        ...state,
        phase: "subscribing",
        statusText: `已连接，正在初始化通知 · ${deviceLabel(event.device)}`,
        error: undefined,
        device: event.device,
        lastDevice: event.device,
        subscriptions: createBleSubscriptions("pending")
      };
    case "subscriptions_resolved": {
      const partial = subscriptionNames.some(name =>
        isDegradedSubscription(name, event.subscriptions)
      );
      return {
        ...state,
        phase: partial ? "connected_partial" : "connected",
        statusText: partial
          ? `已连接 · 部分能力不可用 · ${deviceLabel(state.device)}`
          : `已连接 · ${deviceLabel(state.device)}`,
        error: partial
          ? subscriptionFailureSummary(event.subscriptions)
          : undefined,
        subscriptions: event.subscriptions,
        resumePhase: partial ? "connected_partial" : "connected"
      };
    }
    case "connect_failed":
      return {
        ...state,
        phase: "connect_failed",
        statusText: "连接失败",
        error: event.error,
        device: undefined,
        lastDevice: event.device || state.lastDevice,
        subscriptions: createBleSubscriptions()
      };
    case "disconnect_started":
      return {
        ...state,
        phase: "disconnecting",
        statusText: "正在断开…",
        error: undefined,
        resumePhase: ["subscribing", "connected", "connected_partial"].includes(
          state.phase
        )
          ? (state.phase as
              | "subscribing"
              | "connected"
              | "connected_partial")
          : "connected"
      };
    case "disconnect_failed":
      if (!event.connected) {
        return {
          ...state,
          phase: "idle",
          statusText: "待连接",
          error: undefined,
          device: undefined,
          subscriptions: createBleSubscriptions()
        };
      }
      return {
        ...state,
        phase: state.resumePhase || "connected",
        statusText: `断开失败 · ${deviceLabel(state.device)}`,
        error: event.error
      };
    case "disconnected": {
      const lastDevice = event.device || state.device || state.lastDevice;
      return {
        ...state,
        phase: "disconnected",
        statusText: "连接已断开",
        error: event.error || "设备离线或超出范围",
        device: undefined,
        lastDevice,
        subscriptions: createBleSubscriptions()
      };
    }
    case "event_stream_connecting":
      return { ...state, eventStream: "connecting" };
    case "event_stream_open":
      return { ...state, eventStream: "open" };
    case "event_stream_reconnecting":
      return { ...state, eventStream: "reconnecting" };
    case "event_stream_failed":
      return { ...state, eventStream: "failed" };
  }
}

export function getBleConnectionControls(
  state: BleConnectionState
): BleConnectionControls {
  const busyPhases: BleConnectionPhase[] = [
    "syncing",
    "scanning",
    "connecting",
    "subscribing",
    "disconnecting",
    "reconnecting"
  ];
  const connectedPhases: BleConnectionPhase[] = [
    "subscribing",
    "connected",
    "connected_partial",
    "disconnecting"
  ];
  const busy = busyPhases.includes(state.phase);
  return {
    busy,
    scanDisabled:
      state.phase !== "scanning" &&
      (busy || connectedPhases.includes(state.phase)),
    scanLabel: state.phase === "scanning" ? "停止扫描" : "扫描设备",
    connectDisabled: state.phase !== "scan_ready",
    disconnectVisible: connectedPhases.includes(state.phase),
    disconnectDisabled: state.phase === "disconnecting",
    reconnectVisible:
      Boolean(state.lastDevice) &&
      ["connect_failed", "disconnected"].includes(state.phase),
    reconnectDisabled: state.phase === "reconnecting",
    filtersDisabled: busy || connectedPhases.includes(state.phase)
  };
}
