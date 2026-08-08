export const C1_DOCK_APP_JSON_EVENT = "ble-app-json";

export type C1DockIpMode = "dhcp" | "static";
export type C1DockSsidMode = "base64" | "text";
export type C1DockScanStatus = "idle" | "waiting" | "ok" | "cancelled" | "error";

export interface C1DockConfigureInput {
  requestId?: string;
  ssidMode: C1DockSsidMode;
  ssidBase64?: string;
  ssidText?: string;
  password: string;
  ipMode: C1DockIpMode;
  ipv4?: string;
  prefix?: number;
  gateway?: string;
  dns1?: string;
  dns2?: string;
}

export interface C1DockCommand {
  c: "wifi.scan" | "wifi.configure" | "wifi.cancel" | "wifi.provision.status";
  p?: Record<string, string | number>;
}

export interface C1DockAccessPoint {
  attempt: number;
  sequence: number;
  security: number;
  ssidText: string;
  ssidBase64: string;
  bssid: string;
  rssi: number | null;
  channel: number | null;
  hidden: boolean;
  deviceTimestamp: number | null;
}

export interface C1DockProvisioningState {
  present: boolean | null;
  phase: string;
  activeAttempt: number;
  lastAttempt: number;
  lastResult: number;
  lastError: string;
  scanCount: number;
  scanAttempt: number;
  scanStatus: C1DockScanStatus;
  scanResults: C1DockAccessPoint[];
  lastDeviceTimestamp: number | null;
}

export interface BleAppJsonDetail {
  payload: unknown;
  raw: string;
  source: string;
  receivedAt: string;
}

export class C1DockValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "C1DockValidationError";
  }
}

export const C1_DOCK_RESULT_NAMES: Record<number, string> = {
  0: "NONE",
  1: "OK",
  2: "SSID_NOT_FOUND",
  3: "AUTH_FAILED",
  4: "ASSOC_TIMEOUT",
  5: "DHCP_FAILED",
  6: "BAD_REQUEST",
  7: "BUSY",
  8: "INTERNAL",
  9: "NOT_INSERTED",
  10: "CANCELLED",
  11: "ACCESSORY_REMOVED",
  12: "STATIC_CONFIG_INVALID",
  13: "MQTT_DNS",
  14: "MQTT_TCP",
  15: "MQTT_TLS",
  16: "MQTT_AUTH",
  17: "MQTT_SUBSCRIBE",
  18: "RESOURCE_EXHAUSTED",
  19: "TRANSPORT_ERROR"
};

export const C1_DOCK_SECURITY_NAMES: Record<number, string> = {
  0: "OPEN",
  1: "WEP",
  2: "WPA",
  3: "WPA2",
  4: "WPA/WPA2",
  5: "WPA2 Enterprise",
  6: "WPA3",
  8: "WAPI",
  255: "UNKNOWN"
};

export function createC1DockProvisioningState(): C1DockProvisioningState {
  return {
    present: null,
    phase: "UNKNOWN",
    activeAttempt: 0,
    lastAttempt: 0,
    lastResult: 0,
    lastError: "NONE",
    scanCount: 0,
    scanAttempt: 0,
    scanStatus: "idle",
    scanResults: [],
    lastDeviceTimestamp: null
  };
}

export function beginC1DockScan(
  state: C1DockProvisioningState
): C1DockProvisioningState {
  return {
    ...state,
    phase: "SCANNING",
    scanCount: 0,
    scanAttempt: 0,
    scanStatus: "waiting",
    scanResults: []
  };
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function normalizeRequestId(value?: string): string | undefined {
  const requestId = String(value ?? "").trim();
  if (!requestId) return undefined;
  const length = utf8Length(requestId);
  if (length > 32) {
    throw new C1DockValidationError("request_id 不能超过 32 字节");
  }
  return requestId;
}

function decodedBase64Length(value: string): number | null {
  const normalized = value.trim();
  if (!normalized || /\s/.test(normalized) || normalized.length % 4 === 1) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const firstPadding = normalized.indexOf("=");
  if (firstPadding >= 0 && firstPadding < normalized.length - 2) return null;
  const rawLength = normalized.replace(/=+$/, "").length;
  return Math.floor((rawLength * 6) / 8);
}

function assertSSID(input: C1DockConfigureInput): Record<string, string> {
  if (input.ssidMode === "base64") {
    const ssidBase64 = String(input.ssidBase64 ?? "").trim();
    const decodedLength = decodedBase64Length(ssidBase64);
    if (decodedLength === null || decodedLength < 1 || decodedLength > 32) {
      throw new C1DockValidationError(
        "ssid_b64 必须是解码后 1～32 字节的有效 Base64"
      );
    }
    return { ssid_b64: ssidBase64 };
  }

  const ssid = String(input.ssidText ?? "");
  const length = utf8Length(ssid);
  if (length < 1 || length > 32) {
    throw new C1DockValidationError("SSID 必须是 1～32 字节");
  }
  return { ssid };
}

function assertPassword(password: string): void {
  const length = utf8Length(password);
  if (length === 0) return;
  if (length >= 8 && length <= 63) return;
  if (length === 64 && /^[0-9a-fA-F]{64}$/.test(password)) return;
  throw new C1DockValidationError(
    "密码须为空（开放网络）、8～63 字节，或 64 位十六进制 raw PSK"
  );
}

function parseIPv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

function isUnicastIPv4(address: number): boolean {
  const first = address >>> 24;
  return (
    address !== 0 &&
    address !== 0xffffffff &&
    first >= 1 &&
    first <= 223 &&
    first !== 127
  );
}

function requireUnicastIPv4(value: string, label: string): number {
  const parsed = parseIPv4(value);
  if (parsed === null || !isUnicastIPv4(parsed)) {
    throw new C1DockValidationError(`${label} 必须是有效的 IPv4 单播地址`);
  }
  return parsed;
}

function buildStaticPayload(
  input: C1DockConfigureInput
): Record<string, string | number> {
  const ipv4 = String(input.ipv4 ?? "").trim();
  const gateway = String(input.gateway ?? "").trim();
  const dns1 = String(input.dns1 ?? "").trim();
  const dns2 = String(input.dns2 ?? "").trim();
  const prefix = Number(input.prefix);

  const ipv4Value = requireUnicastIPv4(ipv4, "IPv4 地址");
  const gatewayValue = requireUnicastIPv4(gateway, "网关");
  requireUnicastIPv4(dns1, "DNS1");
  if (dns2) requireUnicastIPv4(dns2, "DNS2");
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 30) {
    throw new C1DockValidationError("prefix 必须是 1～30 的整数");
  }

  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipv4Value & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  if (ipv4Value === network || ipv4Value === broadcast) {
    throw new C1DockValidationError("IPv4 地址不能是网段地址或广播地址");
  }
  if (
    (gatewayValue & mask) >>> 0 !== network ||
    gatewayValue === network ||
    gatewayValue === broadcast ||
    gatewayValue === ipv4Value
  ) {
    throw new C1DockValidationError(
      "网关必须与 IPv4 同子网，且不能是网段、广播或本机地址"
    );
  }

  const payload: Record<string, string | number> = {
    ipv4,
    prefix,
    gateway,
    dns1
  };
  if (dns2) payload.dns2 = dns2;
  return payload;
}

export function buildWifiScanCommand(requestId?: string): C1DockCommand {
  const normalizedRequestId = normalizeRequestId(requestId);
  return normalizedRequestId
    ? { c: "wifi.scan", p: { request_id: normalizedRequestId } }
    : { c: "wifi.scan" };
}

export function buildWifiConfigureCommand(
  input: C1DockConfigureInput
): C1DockCommand {
  const requestId = normalizeRequestId(input.requestId);
  const ssid = assertSSID(input);
  assertPassword(input.password);

  const payload: Record<string, string | number> = {
    ...(requestId ? { request_id: requestId } : {}),
    ...ssid,
    password: input.password,
    ip_mode: input.ipMode
  };
  if (input.ipMode === "static") {
    Object.assign(payload, buildStaticPayload(input));
  }
  return { c: "wifi.configure", p: payload };
}

export function buildWifiCancelCommand(): C1DockCommand {
  return { c: "wifi.cancel" };
}

export function buildWifiStatusCommand(): C1DockCommand {
  return { c: "wifi.provision.status" };
}

export function redactC1DockCommand(command: C1DockCommand): string {
  if (command.c !== "wifi.configure" || !command.p) {
    return JSON.stringify(command);
  }
  return JSON.stringify({
    ...command,
    p: {
      ...command.p,
      password: "[REDACTED]"
    }
  });
}

export function parseJsonObjects(value: string): Record<string, unknown>[] {
  if (typeof value !== "string") return [];
  const results: Record<string, unknown>[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1;
    if (cursor >= value.length) break;
    if (value[cursor] !== "{") {
      cursor += 1;
      continue;
    }

    const start = cursor;
    let depth = 0;
    let inString = false;
    let escaped = false;
    while (cursor < value.length) {
      const char = value[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(value.slice(start, cursor + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              results.push(parsed);
            }
          } catch {
            // Raw traffic remains visible in the log; invalid JSON is ignored here.
          }
          cursor += 1;
          break;
        }
      }
      cursor += 1;
    }
  }
  return results;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean | null): boolean | null {
  return typeof value === "boolean" ? value : fallback;
}

function decodeSSID(base64Value: string, fallback: string): string {
  if (!base64Value) return fallback;
  try {
    const binary = atob(base64Value);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded || fallback;
  } catch {
    return fallback;
  }
}

function applyScanEvent(
  state: C1DockProvisioningState,
  payload: Record<string, unknown>
): C1DockProvisioningState {
  const result = payload.r;
  if (!result || typeof result !== "object" || Array.isArray(result)) return state;
  const event = result as Record<string, unknown>;
  const attempt = numberValue(event.a, state.scanAttempt);
  const deviceTimestamp =
    typeof payload.ts === "number" ? payload.ts : state.lastDeviceTimestamp;

  if (event.done === true) {
    const status = stringValue(event.status, "error");
    return {
      ...state,
      activeAttempt: state.activeAttempt === attempt ? 0 : state.activeAttempt,
      lastAttempt: attempt || state.lastAttempt,
      lastResult: numberValue(event.code, state.lastResult),
      lastError:
        status === "ok" ? "NONE" : C1_DOCK_RESULT_NAMES[numberValue(event.code)] || status,
      scanCount: numberValue(event.count, state.scanResults.length),
      scanAttempt: attempt,
      scanStatus:
        status === "ok" ? "ok" : status === "cancelled" ? "cancelled" : "error",
      lastDeviceTimestamp: deviceTimestamp
    };
  }

  const nextResults = attempt !== state.scanAttempt ? [] : [...state.scanResults];
  const accessPoint: C1DockAccessPoint = {
    attempt,
    sequence: numberValue(event.q),
    security: numberValue(event.e, 255),
    ssidText: decodeSSID(stringValue(event.sb), stringValue(event.s)),
    ssidBase64: stringValue(event.sb),
    bssid: stringValue(event.m),
    rssi: typeof event.r === "number" ? event.r : null,
    channel: typeof event.ch === "number" ? event.ch : null,
    hidden: event.h === true,
    deviceTimestamp
  };
  const key = accessPoint.bssid || `${accessPoint.attempt}:${accessPoint.sequence}`;
  const existingIndex = nextResults.findIndex(item => {
    const itemKey = item.bssid || `${item.attempt}:${item.sequence}`;
    return itemKey === key;
  });
  if (existingIndex >= 0) nextResults[existingIndex] = accessPoint;
  else nextResults.push(accessPoint);
  nextResults.sort((left, right) => left.sequence - right.sequence);

  return {
    ...state,
    phase: "SCANNING",
    activeAttempt: attempt,
    scanAttempt: attempt,
    scanStatus: "waiting",
    scanCount: nextResults.length,
    scanResults: nextResults,
    lastDeviceTimestamp: deviceTimestamp
  };
}

function applyProvisionEvent(
  state: C1DockProvisioningState,
  payload: Record<string, unknown>
): C1DockProvisioningState {
  const result = payload.r;
  if (!result || typeof result !== "object" || Array.isArray(result)) return state;
  const event = result as Record<string, unknown>;
  const attempt = numberValue(event.a, state.activeAttempt);
  const done = event.done === true;
  const status = stringValue(event.status);
  const code = numberValue(event.code, state.lastResult);
  const error = stringValue(event.error, C1_DOCK_RESULT_NAMES[code] || state.lastError);
  return {
    ...state,
    phase: stringValue(
      event.phase,
      done && status === "ok" ? "OPERATIONAL" : state.phase
    ),
    activeAttempt: done ? 0 : attempt,
    lastAttempt: done ? attempt : state.lastAttempt,
    lastResult: code,
    lastError: error || (code === 1 ? "NONE" : state.lastError),
    lastDeviceTimestamp:
      typeof payload.ts === "number" ? payload.ts : state.lastDeviceTimestamp
  };
}

function applyStatusResponse(
  state: C1DockProvisioningState,
  payload: Record<string, unknown>
): C1DockProvisioningState {
  const result = payload.r;
  if (!result || typeof result !== "object" || Array.isArray(result)) return state;
  const snapshot = result as Record<string, unknown>;
  return {
    ...state,
    present: booleanValue(snapshot.present, state.present),
    phase: stringValue(snapshot.phase, state.phase),
    activeAttempt: numberValue(snapshot.attempt, state.activeAttempt),
    lastAttempt: numberValue(snapshot.last_attempt, state.lastAttempt),
    lastResult: numberValue(snapshot.last_result, state.lastResult),
    lastError: stringValue(snapshot.last_error, state.lastError),
    scanCount: numberValue(snapshot.scan_count, state.scanCount)
  };
}

export function reduceC1DockProvisioningPayload(
  state: C1DockProvisioningState,
  value: unknown
): C1DockProvisioningState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return state;
  const payload = value as Record<string, unknown>;
  if (payload.e === "wifi-scan") return applyScanEvent(state, payload);
  if (payload.e === "wifi-provision") return applyProvisionEvent(state, payload);
  if (payload.c === "wifi.provision.status") return applyStatusResponse(state, payload);
  return state;
}

export function isC1DockProvisioningPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.e === "wifi-scan" ||
    payload.e === "wifi-provision" ||
    ["wifi.scan", "wifi.configure", "wifi.cancel", "wifi.provision.status"].includes(
      String(payload.c ?? "")
    )
  );
}

export function describeC1DockCommandResponse(
  command: C1DockCommand,
  payload: Record<string, unknown> | undefined
): { ok: boolean; message: string } {
  if (!payload) return { ok: false, message: "未收到可解析的同步响应" };
  if (payload.c !== command.c) {
    return { ok: false, message: `响应命令不匹配：${String(payload.c ?? "未知")}` };
  }
  if (typeof payload.e === "number") {
    const detail = stringValue(payload.m, C1_DOCK_RESULT_NAMES[Math.abs(payload.e)] || "");
    return {
      ok: false,
      message: `命令被拒绝：e=${payload.e}${detail ? ` (${detail})` : ""}`
    };
  }
  if (payload.r === 0 || (payload.r && typeof payload.r === "object")) {
    return {
      ok: true,
      message:
        command.c === "wifi.scan"
          ? "扫描已接受，等待 wifi-scan 终态"
          : command.c === "wifi.configure"
            ? "配网已接受，等待 wifi-provision 终态"
            : command.c === "wifi.cancel"
              ? "取消请求已接受"
              : "状态快照已更新"
    };
  }
  return { ok: false, message: `设备返回未识别结果：${JSON.stringify(payload.r)}` };
}
