import type {
  BleConnectionEvent,
  BleConnectionState
} from "./connectionState.ts";

export type KnownState = "unknown" | "known";
export type IdentityState = "unknown" | "checking" | "verified" | "failed";
export type CapabilityState =
  | "unknown"
  | "checking"
  | "available"
  | "unavailable"
  | "failed"
  | "policy_blocked";
export type SafetyStreamState =
  | "connecting"
  | "fresh"
  | "reconnecting"
  | "stale"
  | "snapshot_syncing"
  | "failed";
export type SafetyTaskState =
  | "idle"
  | "queued"
  | "sending"
  | "accepted"
  | "running"
  | "cancelling"
  | "succeeded"
  | "partial_succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "interrupted"
  | "unknown_result";
export type SafetyReasonCode =
  | "allowed"
  | "policy_blocked"
  | "service_unavailable"
  | "device_not_connected"
  | "identity_unknown"
  | "event_stream_untrusted"
  | "task_in_flight"
  | "capability_unknown"
  | "capability_checking"
  | "capability_unavailable"
  | "capability_failed"
  | "risk_unknown"
  | "parameters_invalid";

export interface SafetyCapability {
  state: CapabilityState;
  source: "unknown" | "snapshot" | "subscription";
  diagnostic?: string;
}

export interface SafetySessionState {
  localService: "checking" | "ready" | "unavailable";
  link: "disconnected" | "connecting" | "connected";
  identity: IdentityState;
  device: {
    key?: string;
    model?: string;
    firmware?: string;
    protocol?: string;
  };
  capabilities: Record<string, SafetyCapability>;
  stream: {
    state: SafetyStreamState;
    recoveryRequired: boolean;
    sequence?: number;
    droppedCount: number;
    diagnostic?: string;
  };
  task: {
    id?: string;
    action?: string;
    state: SafetyTaskState;
    diagnostic?: string;
  };
}

export interface DeviceActionPolicy {
  action: string;
  capability?: string;
  risk: "safe_read" | "write_confirm" | "destructive_confirm" | "risk_unknown";
  policy?: "allowed" | "policy_blocked";
  parametersValid?: boolean;
}

export interface SafetyDecision {
  allowed: boolean;
  code: SafetyReasonCode;
  reason: string;
  action: string;
}

export type SafetySessionEvent =
  | BleConnectionEvent
  | { type: "stream_event"; sequence?: number; droppedCount?: number }
  | {
      type: "snapshot_reconciled";
      sessionId?: string;
      deviceKey?: string;
      model?: string;
      firmware?: string;
      protocol?: string;
      capabilities?: Record<string, boolean>;
      taskState?: SafetyTaskState;
    }
  | { type: "snapshot_failed"; error: string }
  | { type: "task_started"; id: string; action: string }
  | { type: "task_accepted"; id: string }
  | {
      type: "task_finished";
      id: string;
      outcome: Extract<
        SafetyTaskState,
        "succeeded" | "partial_succeeded" | "failed" | "timed_out" | "cancelled"
      >;
      diagnostic?: string;
    };

export const SAFE_FALLBACK_LOG_MAX_ENTRIES = 1000;
export const SAFE_FALLBACK_LOG_MAX_BYTES = 256 * 1024;

const activeTaskStates: SafetyTaskState[] = [
  "queued",
  "sending",
  "accepted",
  "running",
  "cancelling"
];
const unresolvedTaskStates: SafetyTaskState[] = [
  ...activeTaskStates,
  "timed_out",
  "interrupted",
  "unknown_result"
];

const sensitiveKeyPattern =
  /^(?:ac|activation_?code|activationcode|password|passwd|pwd|psk|authorization|cookie|set-cookie|token|access_?token|refresh_?token|secret|body|rawbody)$/i;
const macPattern =
  /\b([0-9a-f]{2})[:-]([0-9a-f]{2})(?:[:-][0-9a-f]{2}){2}[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})\b/gi;
const iccidPattern = /\b\d{18,22}\b/g;

export function createSafetySessionState(): SafetySessionState {
  return {
    localService: "checking",
    link: "disconnected",
    identity: "unknown",
    device: {},
    capabilities: {
      fence_write: { state: "policy_blocked", source: "unknown" }
    },
    stream: {
      state: "connecting",
      recoveryRequired: true,
      droppedCount: 0,
      diagnostic: "等待事件流和状态快照完成对账"
    },
    task: { state: "idle" }
  };
}

function resetUnknownDeviceState(
  state: SafetySessionState,
  deviceKey?: string
): SafetySessionState {
  const task = activeTaskStates.includes(state.task.state)
    ? {
        ...state.task,
        state: "unknown_result" as const,
        diagnostic: "设备会话变化，任务结果未知"
      }
    : { state: "idle" as const };
  return {
    ...state,
    identity: "unknown",
    device: { key: deviceKey },
    capabilities: {
      fence_write: { state: "policy_blocked", source: "unknown" }
    },
    task
  };
}

export function reduceSafetySessionState(
  state: SafetySessionState,
  event: SafetySessionEvent
): SafetySessionState {
  switch (event.type) {
    case "sync_started":
      return { ...state, localService: "checking" };
    case "backend_unavailable":
      return { ...state, localService: "unavailable" };
    case "sync_idle":
      return {
        ...resetUnknownDeviceState(state),
        localService: "ready",
        link: "disconnected"
      };
    case "scan_started":
    case "scan_updated":
    case "scan_stopped":
    case "scan_failed":
      return { ...state, localService: "ready" };
    case "connect_started":
    case "reconnect_started":
      return {
        ...resetUnknownDeviceState(state, event.device.address),
        localService: "ready",
        link: "connecting"
      };
    case "sync_connected":
    case "subscribing":
      return {
        ...resetUnknownDeviceState(state, event.device.address),
        localService: "ready",
        link: "connected"
      };
    case "subscriptions_resolved":
      return {
        ...state,
        localService: "ready",
        link: "connected",
        capabilities: {
          ...state.capabilities,
          ...Object.fromEntries(
            Object.entries(event.subscriptions).map(([name, subscription]) => [
              name,
              {
                state:
                  subscription.status === "ready"
                    ? "available"
                    : subscription.status === "pending"
                      ? "checking"
                      : subscription.status === "failed"
                        ? "failed"
                        : "unavailable",
                source: "subscription",
                diagnostic: subscription.error
              } satisfies SafetyCapability
            ])
          )
        }
      };
    case "connect_failed":
      return {
        ...resetUnknownDeviceState(state),
        localService: "ready",
        link: "disconnected"
      };
    case "disconnect_started":
      return {
        ...state,
        task: activeTaskStates.includes(state.task.state)
          ? {
              ...state.task,
              state: "unknown_result",
              diagnostic: "断开过程中任务结果未知"
            }
          : state.task
      };
    case "disconnect_failed":
      return event.connected
        ? { ...state, link: "connected" }
        : {
            ...resetUnknownDeviceState(state),
            link: "disconnected"
          };
    case "disconnected":
      return {
        ...resetUnknownDeviceState(state),
        link: "disconnected"
      };
    case "event_stream_connecting":
      return {
        ...state,
        stream: {
          ...state.stream,
          state: "connecting",
          recoveryRequired: true,
          diagnostic: "事件流连接中，等待快照对账"
        }
      };
    case "event_stream_reconnecting":
      return {
        ...state,
        stream: {
          ...state.stream,
          state: "stale",
          recoveryRequired: true,
          diagnostic: "事件流已中断，当前状态可能过期"
        }
      };
    case "event_stream_failed":
      return {
        ...state,
        stream: {
          ...state.stream,
          state: "failed",
          recoveryRequired: true,
          diagnostic: "事件流不可用，禁止设备操作"
        }
      };
    case "event_stream_open":
      return {
        ...state,
        stream: state.stream.recoveryRequired
          ? {
              ...state.stream,
              state: "snapshot_syncing",
              diagnostic: "事件流已恢复，等待状态快照对账"
            }
          : { ...state.stream, state: "fresh", diagnostic: undefined }
      };
    case "stream_event": {
      const previousSequence = state.stream.sequence;
      const sequenceGap =
        previousSequence !== undefined &&
        event.sequence !== undefined &&
        event.sequence !== previousSequence + 1;
      const droppedCount = Math.max(
        state.stream.droppedCount,
        event.droppedCount ?? 0
      );
      const dropped = droppedCount > state.stream.droppedCount;
      if (sequenceGap || dropped) {
        return {
          ...state,
          stream: {
            ...state.stream,
            state: "stale",
            recoveryRequired: true,
            sequence: event.sequence,
            droppedCount,
            diagnostic: sequenceGap
              ? `事件序列断档: ${previousSequence} → ${event.sequence}`
              : `事件丢弃累计: ${droppedCount}`
          }
        };
      }
      return {
        ...state,
        stream: { ...state.stream, sequence: event.sequence, droppedCount }
      };
    }
    case "snapshot_reconciled": {
      const complete =
        Boolean(event.sessionId) &&
        Boolean(event.deviceKey) &&
        Boolean(event.model) &&
        Boolean(event.firmware) &&
        Boolean(event.protocol) &&
        Boolean(event.capabilities) &&
        Boolean(event.taskState);
      if (!complete) {
        return {
          ...state,
          stream: {
            ...state.stream,
            state: "failed",
            recoveryRequired: true,
            diagnostic: "快照缺少会话、设备、能力或任务字段"
          }
        };
      }
      const deviceChanged =
        Boolean(state.device.key) && state.device.key !== event.deviceKey;
      const capabilities: Record<string, SafetyCapability> = Object.fromEntries(
        Object.entries(event.capabilities || {}).map(([name, supported]) => [
          name,
          {
            state: supported ? "available" : "unavailable",
            source: "snapshot"
          } satisfies SafetyCapability
        ])
      );
      capabilities.fence_write = {
        state: "policy_blocked",
        source: "unknown"
      };
      return {
        ...state,
        identity: "verified",
        device: {
          key: event.deviceKey,
          model: event.model,
          firmware: event.firmware,
          protocol: event.protocol
        },
        capabilities,
        stream: {
          ...state.stream,
          state: "fresh",
          recoveryRequired: false,
          diagnostic: undefined
        },
        task: deviceChanged
          ? {
              state: "unknown_result",
              diagnostic: "对账发现设备会话变化，旧任务结果未知"
            }
          : { state: event.taskState || "unknown_result" }
      };
    }
    case "snapshot_failed":
      return {
        ...state,
        stream: {
          ...state.stream,
          state: "failed",
          recoveryRequired: true,
          diagnostic: event.error
        }
      };
    case "task_started":
      if (activeTaskStates.includes(state.task.state)) return state;
      return {
        ...state,
        task: { id: event.id, action: event.action, state: "sending" }
      };
    case "task_accepted":
      if (state.task.id !== event.id) return state;
      return { ...state, task: { ...state.task, state: "accepted" } };
    case "task_finished":
      if (state.task.id !== event.id) return state;
      return {
        ...state,
        task: {
          ...state.task,
          state: event.outcome,
          diagnostic: event.diagnostic
        }
      };
  }
}

export function syncSafetyWithConnection(
  state: SafetySessionState,
  connection: BleConnectionState
): SafetySessionState {
  const localService =
    connection.phase === "backend_unavailable"
      ? "unavailable"
      : connection.phase === "syncing"
        ? "checking"
        : "ready";
  const link = ["subscribing", "connected", "connected_partial"].includes(
    connection.phase
  )
    ? "connected"
    : ["connecting", "reconnecting"].includes(connection.phase)
      ? "connecting"
      : "disconnected";
  return { ...state, localService, link };
}

function blocked(
  policy: DeviceActionPolicy,
  code: Exclude<SafetyReasonCode, "allowed">,
  reason: string
): SafetyDecision {
  return { allowed: false, code, reason, action: policy.action };
}

export function evaluateSafetyGate(
  state: SafetySessionState,
  policy: DeviceActionPolicy
): SafetyDecision {
  const requiresTrustedIdentity = policy.risk === "destructive_confirm";
  if (policy.policy === "policy_blocked") {
    return blocked(policy, "policy_blocked", "策略未定义，当前操作已硬冻结");
  }
  if (state.localService !== "ready") {
    return blocked(policy, "service_unavailable", "本地 BLE 服务尚未就绪");
  }
  if (state.link !== "connected") {
    return blocked(policy, "device_not_connected", "设备未连接");
  }
  if (requiresTrustedIdentity && state.identity !== "verified") {
    return blocked(
      policy,
      "identity_unknown",
      "高风险操作需要先核验设备型号、固件与协议身份"
    );
  }
  if (
    requiresTrustedIdentity &&
    (state.stream.state !== "fresh" || state.stream.recoveryRequired)
  ) {
    return blocked(
      policy,
      "event_stream_untrusted",
      state.stream.diagnostic || "事件状态未完成快照对账"
    );
  }
  if (
    !requiresTrustedIdentity &&
    Boolean(policy.capability) &&
    ["stale", "failed"].includes(state.stream.state)
  ) {
    return blocked(
      policy,
      "event_stream_untrusted",
      "当前设备不具备所需的订阅和/或发送能力：通知事件流不可用"
    );
  }
  if (unresolvedTaskStates.includes(state.task.state)) {
    return blocked(
      policy,
      "task_in_flight",
      activeTaskStates.includes(state.task.state)
        ? "已有设备任务执行中"
        : "上一个设备任务结果尚未完成对账"
    );
  }
  if (policy.capability) {
    const capability = state.capabilities[policy.capability];
    if (!capability || capability.state === "unknown") {
      return blocked(
        policy,
        "capability_unknown",
        `当前设备不具备所需的订阅和/或发送能力：缺失通道 ${policy.capability.toUpperCase()}（尚未完成能力探测）`
      );
    }
    if (capability.state === "checking") {
      return blocked(
        policy,
        "capability_checking",
        `正在核对所需通道 ${policy.capability.toUpperCase()} 的订阅和发送能力`
      );
    }
    if (capability.state === "failed") {
      return blocked(
        policy,
        "capability_failed",
        `当前设备不具备所需的订阅和/或发送能力：缺失通道 ${policy.capability.toUpperCase()}（订阅或能力检查失败${capability.diagnostic ? `：${capability.diagnostic}` : ""}）`
      );
    }
    if (capability.state === "unavailable") {
      return blocked(
        policy,
        "capability_unavailable",
        `当前设备不具备所需的订阅和/或发送能力：缺失通道 ${policy.capability.toUpperCase()}（设备未提供该通道）`
      );
    }
    if (capability.state === "policy_blocked") {
      return blocked(
        policy,
        "policy_blocked",
        `安全策略已暂停能力 ${policy.capability}`
      );
    }
  }
  if (policy.risk === "risk_unknown") {
    return blocked(policy, "risk_unknown", "操作风险规则缺失，禁止执行");
  }
  if (policy.parametersValid === false) {
    return blocked(policy, "parameters_invalid", "参数校验未通过");
  }
  return {
    allowed: true,
    code: "allowed",
    reason: "安全门禁已满足",
    action: policy.action
  };
}

export function canStartTask(state: SafetySessionState): boolean {
  return !unresolvedTaskStates.includes(state.task.state);
}

function maskIccid(value: string): string {
  return value.length > 8
    ? `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`
    : "[MASKED_ICCID]";
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return value.replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, "$1=[REDACTED]");
  }
}

function sanitizeStructured(value: unknown, key = ""): unknown {
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (/^(?:url|uri|endpoint)$/i.test(key)) return sanitizeUrl(value);
    if (/iccid/i.test(key)) return maskIccid(value);
    return sanitizePlainText(value);
  }
  if (Array.isArray(value)) return value.map(item => sanitizeStructured(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeStructured(entryValue, entryKey)
      ])
    );
  }
  return value;
}

function sanitizePlainText(input: string): string {
  return input
    .replace(/LPA:1\$[^\s$]+\$[^\s]+/gi, "[REDACTED_ACTIVATION_CODE]")
    .replace(
      /((?:"|')?(?:ac|activation_?code|password|passwd|pwd|psk|authorization|cookie|token|access_?token|refresh_?token|secret|body|rawbody)(?:"|')?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      "$1[REDACTED]"
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, match => sanitizeUrl(match))
    .replace(iccidPattern, match => maskIccid(match))
    .replace(macPattern, "$1:$2:**:**:$3:$4");
}

export function sanitizeLogText(input: unknown): string {
  const text = String(input ?? "");
  try {
    return JSON.stringify(sanitizeStructured(JSON.parse(text)));
  } catch {
    return sanitizePlainText(text);
  }
}

export interface BoundedLogResult {
  text: string;
  droppedEntries: number;
  truncated: boolean;
}

export function appendSanitizedBoundedLog(
  current: string,
  incoming: unknown,
  maxEntries = SAFE_FALLBACK_LOG_MAX_ENTRIES,
  maxBytes = SAFE_FALLBACK_LOG_MAX_BYTES
): BoundedLogResult {
  const safeIncoming = sanitizeLogText(incoming);
  const combined = `${current || ""}${safeIncoming}`;
  let entries = combined.split("\n");
  let droppedEntries = Math.max(0, entries.length - maxEntries);
  if (droppedEntries > 0) entries = entries.slice(-maxEntries);
  let text = entries.join("\n");
  const encoder = new TextEncoder();
  const output = () =>
    droppedEntries > 0
      ? `[已丢弃 ${droppedEntries} 条较早日志]\n${text}`
      : text;
  while (entries.length > 1 && encoder.encode(output()).byteLength > maxBytes) {
    entries.shift();
    droppedEntries += 1;
    text = entries.join("\n");
  }
  if (encoder.encode(output()).byteLength > maxBytes) {
    const characters = Array.from(text);
    droppedEntries = Math.max(1, droppedEntries);
    while (
      characters.length > 0 &&
      encoder.encode(
        `[已丢弃 ${droppedEntries} 条较早日志]\n${characters.join("")}`
      ).byteLength > maxBytes
    ) {
      characters.shift();
    }
    text = characters.join("");
  }
  const truncated = droppedEntries > 0;
  return {
    text: output(),
    droppedEntries,
    truncated
  };
}

export function prepareLogForOutput(text: unknown): string {
  return appendSanitizedBoundedLog("", text).text;
}

export function getNextTabIndex(
  currentIndex: number,
  key: string,
  count: number
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (currentIndex + 1) % count;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (currentIndex - 1 + count) % count;
  }
  return null;
}
