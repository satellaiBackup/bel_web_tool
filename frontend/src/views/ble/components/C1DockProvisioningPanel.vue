<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { LegacyBridge } from "../types";
import {
  beginC1DockScan,
  buildWifiCancelCommand,
  buildWifiConfigureCommand,
  buildWifiScanCommand,
  buildWifiStatusCommand,
  C1_DOCK_APP_JSON_EVENT,
  C1_DOCK_RESULT_NAMES,
  C1_DOCK_SECURITY_NAMES,
  createC1DockProvisioningState,
  describeC1DockCommandResponse,
  isC1DockProvisioningPayload,
  parseJsonObjects,
  redactC1DockCommand,
  reduceC1DockProvisioningPayload,
  type BleAppJsonDetail,
  type C1DockAccessPoint,
  type C1DockCommand,
  type C1DockIpMode,
  type C1DockSsidMode
} from "../c1DockProvisioning";
import BleLogPanel from "./BleLogPanel.vue";

defineOptions({
  name: "C1DockProvisioningPanel"
});

const props = defineProps<{
  bridge: LegacyBridge;
  focusedLogId: string | null;
}>();

const protocolState = ref(createC1DockProvisioningState());
const scanRequestId = ref(makeRequestId("scan"));
const configureRequestId = ref(makeRequestId("cfg"));
const ssidMode = ref<C1DockSsidMode>("text");
const ssidText = ref("");
const ssidBase64 = ref("");
const selectedBssid = ref("");
const password = ref("");
const passwordVisible = ref(false);
const ipMode = ref<C1DockIpMode>("dhcp");
const ipv4 = ref("192.168.8.20");
const prefix = ref(24);
const gateway = ref("192.168.8.1");
const dns1 = ref("1.1.1.1");
const dns2 = ref("8.8.8.8");
const commandBusy = ref(false);
const message = ref("先连接设备，再扫描附近 AP 或查询当前配网状态。");
const messageTone = ref<"info" | "success" | "error">("info");

const resultLabel = computed(() => {
  const code = protocolState.value.lastResult;
  return `${code} · ${C1_DOCK_RESULT_NAMES[code] || "UNKNOWN"}`;
});

const presenceLabel = computed(() => {
  if (protocolState.value.present === null) return "未查询";
  return protocolState.value.present ? "PRESENT" : "ABSENT";
});

const scanStatusLabel = computed(() => {
  const labels = {
    idle: "未开始",
    waiting: "等待扫描结果",
    ok: "扫描完成",
    cancelled: "扫描已取消",
    error: "扫描失败"
  };
  return labels[protocolState.value.scanStatus];
});

const statusRows = computed(() => [
  ["在位门禁", presenceLabel.value],
  ["当前阶段", protocolState.value.phase],
  ["活动 attempt", protocolState.value.activeAttempt || "—"],
  ["最近 attempt", protocolState.value.lastAttempt || "—"],
  ["最近结果", resultLabel.value],
  ["详细原因", protocolState.value.lastError || "NONE"],
  ["扫描计数", protocolState.value.scanCount],
  [
    "设备 ts",
    protocolState.value.lastDeviceTimestamp === null
      ? "—"
      : `${protocolState.value.lastDeviceTimestamp} ms (uptime)`
  ]
]);

function makeRequestId(prefixValue: string): string {
  return `${prefixValue}-${Date.now().toString(36)}`.slice(0, 32);
}

function setMessage(
  value: string,
  tone: "info" | "success" | "error" = "info"
): void {
  message.value = value;
  messageTone.value = tone;
}

function applyPayload(payload: unknown): void {
  if (!isC1DockProvisioningPayload(payload)) return;
  protocolState.value = reduceC1DockProvisioningPayload(
    protocolState.value,
    payload
  );
}

function handleAppJsonEvent(event: Event): void {
  const detail = (event as CustomEvent<BleAppJsonDetail>).detail;
  if (detail) applyPayload(detail.payload);
}

function responseForCommand(
  command: C1DockCommand,
  rawResponse: string
): Record<string, unknown> | undefined {
  const payloads = parseJsonObjects(rawResponse);
  payloads.forEach(applyPayload);
  return payloads.find(payload => payload.c === command.c);
}

async function sendCommand(command: C1DockCommand): Promise<boolean> {
  commandBusy.value = true;
  try {
    const rawCommand = JSON.stringify(command);
    const rawResponse = await props.bridge.callAsync<string | null>(
      "sendAppCommandViaBle",
      rawCommand,
      {
        containerSelector: "#c1DockProvisioningSection",
        logElementId: "c1DockProvisioningLog",
        labelPrefix: "C1DOCK",
        expectedCommand: command.c,
        responseTimeout: 2000,
        maxWait: 15000,
        logRequestText: redactC1DockCommand(command),
        logResponse: false
      }
    );
    const parsedResponse =
      typeof rawResponse === "string"
        ? responseForCommand(command, rawResponse)
        : undefined;
    const result = describeC1DockCommandResponse(command, parsedResponse);
    setMessage(result.message, result.ok ? "success" : "error");
    return result.ok;
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : String(error),
      "error"
    );
    return false;
  } finally {
    commandBusy.value = false;
  }
}

async function startScan(): Promise<void> {
  try {
    const command = buildWifiScanCommand(scanRequestId.value);
    protocolState.value = beginC1DockScan(protocolState.value);
    await sendCommand(command);
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : String(error),
      "error"
    );
  }
}

async function configureWifi(): Promise<void> {
  try {
    const command = buildWifiConfigureCommand({
      requestId: configureRequestId.value,
      ssidMode: ssidMode.value,
      ssidBase64: ssidBase64.value,
      ssidText: ssidText.value,
      password: password.value,
      ipMode: ipMode.value,
      ipv4: ipv4.value,
      prefix: prefix.value,
      gateway: gateway.value,
      dns1: dns1.value,
      dns2: dns2.value
    });
    const accepted = await sendCommand(command);
    if (accepted) password.value = "";
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : String(error),
      "error"
    );
  }
}

async function cancelAttempt(): Promise<void> {
  await sendCommand(buildWifiCancelCommand());
}

async function queryStatus(): Promise<void> {
  await sendCommand(buildWifiStatusCommand());
}

function selectAccessPoint(accessPoint: C1DockAccessPoint): void {
  selectedBssid.value = accessPoint.bssid;
  if (accessPoint.ssidBase64) {
    ssidMode.value = "base64";
    ssidBase64.value = accessPoint.ssidBase64;
    ssidText.value = accessPoint.ssidText;
  } else {
    ssidMode.value = "text";
    ssidText.value = accessPoint.ssidText;
    ssidBase64.value = "";
  }
  setMessage(
    `已选择 ${accessPoint.ssidText || "隐藏 SSID"} (${accessPoint.bssid || "无 BSSID"})`,
    "info"
  );
}

onMounted(() => {
  window.addEventListener(C1_DOCK_APP_JSON_EVENT, handleAppJsonEvent);
});

onUnmounted(() => {
  window.removeEventListener(C1_DOCK_APP_JSON_EVENT, handleAppJsonEvent);
});
</script>

<template>
  <section
    id="c1DockProvisioningSection"
    class="admin-section c1-dock-provisioning"
    data-ble-requires="app"
  >
    <div class="section-heading">
      <p class="eyebrow">C1 Dock · SAT-9</p>
      <h2>BLE Wi-Fi 配网调试</h2>
      <span>
        通过 APP `/e` 与 TRANSPORT CH=3 调试扫描、DHCP/静态配网、取消、状态恢复和 AWS 就绪链。
      </span>
    </div>

    <article class="admin-card">
      <div class="card-heading split">
        <div>
          <h3>实时状态</h3>
          <p>云阶段 13～17 表示可恢复重试，不等同于 Wi-Fi 失败。</p>
        </div>
        <div class="button-group">
          <button
            class="cmd cmd-button secondary"
            type="button"
            :disabled="commandBusy"
            @click="queryStatus"
          >
            查询状态
          </button>
          <button
            class="cmd cmd-button warning"
            type="button"
            :disabled="commandBusy"
            @click="cancelAttempt"
          >
            取消当前 attempt
          </button>
        </div>
      </div>

      <div class="c1-status-grid">
        <div v-for="([label, value], index) in statusRows" :key="index" class="metric-card">
          <span>{{ label }}</span>
          <strong>{{ value }}</strong>
        </div>
      </div>

      <div class="c1-message" :data-tone="messageTone" role="status">
        {{ message }}
      </div>
    </article>

    <article class="admin-card">
      <div class="card-heading split">
        <div>
          <h3>1. 扫描 2.4 GHz AP</h3>
          <p>每个 AP 一条 `wifi-scan` 事件；必须等待 `done=true` 收口。</p>
        </div>
        <span class="c1-scan-badge" :data-status="protocolState.scanStatus">
          {{ scanStatusLabel }} · {{ protocolState.scanResults.length }} 条
        </span>
      </div>

      <div class="form-row c1-request-row">
        <label class="form-field form-field-wide">
          <span>request_id（可复用以验证幂等）</span>
          <input
            v-model="scanRequestId"
            class="cmd cmd-input admin-input"
            type="text"
            maxlength="32"
            disabled
          />
        </label>
        <button
          class="cmd cmd-button secondary"
          type="button"
          disabled
          @click="scanRequestId = makeRequestId('scan')"
        >
          生成新 ID
        </button>
        <button
          class="cmd cmd-button"
          type="button"
          :disabled="commandBusy"
          @click="startScan"
        >
          开始扫描
        </button>
      </div>

      <div class="result-panel c1-scan-results">
        <table v-if="protocolState.scanResults.length" class="c1-table">
          <thead>
            <tr>
              <th>SSID</th>
              <th>BSSID</th>
              <th>RSSI</th>
              <th>安全</th>
              <th>信道</th>
              <th>attempt / seq</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="accessPoint in protocolState.scanResults"
              :key="`${accessPoint.attempt}-${accessPoint.bssid || accessPoint.sequence}`"
              :class="{ 'is-selected': selectedBssid && selectedBssid === accessPoint.bssid }"
            >
              <td>
                <strong>{{ accessPoint.ssidText || "(隐藏/非文本)" }}</strong>
                <small v-if="accessPoint.hidden">hidden</small>
              </td>
              <td><code>{{ accessPoint.bssid || "—" }}</code></td>
              <td>{{ accessPoint.rssi === null ? "—" : `${accessPoint.rssi} dBm` }}</td>
              <td>{{ C1_DOCK_SECURITY_NAMES[accessPoint.security] || accessPoint.security }}</td>
              <td>{{ accessPoint.channel ?? "—" }}</td>
              <td>{{ accessPoint.attempt }} / {{ accessPoint.sequence }}</td>
              <td>
                <button
                  class="cmd cmd-button secondary"
                  type="button"
                  disabled
                  @click="selectAccessPoint(accessPoint)"
                >
                  选用
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="c1-empty">尚无扫描结果。</div>
      </div>
    </article>

    <article class="admin-card">
      <div class="card-heading">
        <div>
          <h3>2. 配置候选网络</h3>
          <p>同步 ACK 仅表示已接受；最终以 `wifi-provision` 终态或状态查询为准。</p>
        </div>
      </div>

      <div class="admin-grid two-columns">
        <div class="sub-card form-list">
          <h4>网络与凭据</h4>
          <label class="form-field">
            <span>request_id</span>
            <div class="inline-controls">
              <input
                v-model="configureRequestId"
                class="cmd cmd-input admin-input"
                type="text"
                maxlength="32"
                disabled
              />
              <button
                class="cmd cmd-button secondary"
                type="button"
                disabled
                @click="configureRequestId = makeRequestId('cfg')"
              >
                新 ID
              </button>
            </div>
          </label>

          <label class="form-field">
            <span>SSID 传输方式</span>
            <select v-model="ssidMode" class="cmd admin-input" disabled>
              <option value="base64">ssid_b64（推荐，可逆）</option>
              <option value="text">ssid（仅可打印文本）</option>
            </select>
          </label>

          <label v-if="ssidMode === 'base64'" class="form-field">
            <span>ssid_b64</span>
            <input
              v-model="ssidBase64"
              class="cmd cmd-input admin-input"
              type="text"
              placeholder="例如 SG9tZQ=="
              disabled
            />
            <small>当前显示名：{{ ssidText || "未提供" }}</small>
          </label>
          <label v-else class="form-field">
            <span>SSID</span>
            <input
              v-model="ssidText"
              class="cmd cmd-input admin-input"
              type="text"
              placeholder="1～32 字节"
              disabled
            />
          </label>

          <label class="form-field">
            <span>Wi-Fi 密码（开放网络留空）</span>
            <div class="inline-controls">
              <input
                v-model="password"
                class="cmd cmd-input admin-input"
                :type="passwordVisible ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="8～63 字节或 64 位十六进制 PSK"
                disabled
              />
              <button
                type="button"
                class="cmd-button secondary"
                @click="passwordVisible = !passwordVisible"
              >
                {{ passwordVisible ? "隐藏" : "显示" }}
              </button>
            </div>
            <small>密码不会写入前端日志、后端日志或本地存储。</small>
          </label>
        </div>

        <div class="sub-card form-list">
          <h4>IPv4</h4>
          <label class="form-field">
            <span>模式</span>
            <select v-model="ipMode" class="cmd admin-input" disabled>
              <option value="dhcp">DHCP</option>
              <option value="static">静态 IPv4</option>
            </select>
          </label>

          <template v-if="ipMode === 'static'">
            <label class="form-field">
              <span>IPv4 / prefix</span>
              <div class="inline-controls">
                <input v-model="ipv4" class="cmd cmd-input admin-input" type="text" disabled />
                <input
                  v-model.number="prefix"
                  class="cmd cmd-input admin-input narrow"
                  type="number"
                  min="1"
                  max="30"
                  disabled
                />
              </div>
            </label>
            <label class="form-field">
              <span>网关</span>
              <input v-model="gateway" class="cmd cmd-input admin-input" type="text" disabled />
            </label>
            <label class="form-field">
              <span>DNS1 / DNS2</span>
              <div class="inline-controls">
                <input v-model="dns1" class="cmd cmd-input admin-input" type="text" disabled />
                <input v-model="dns2" class="cmd cmd-input admin-input" type="text" disabled />
              </div>
            </label>
          </template>
          <p v-else class="hint">设备关联成功后启动 DHCP；无需填写静态地址。</p>

          <button
            class="cmd cmd-button"
            type="button"
            :disabled="commandBusy"
            @click="configureWifi"
          >
            提交配网
          </button>
        </div>
      </div>
    </article>

    <article class="admin-card">
      <BleLogPanel
        title="C1 Dock 原始协议日志（password 已脱敏）"
        panel-id="c1DockProvisioningLog"
        size="medium"
        :focused-log-id="focusedLogId"
        :clear-panel="bridge.clearPanel"
        :focus-log="bridge.focusLog"
      />
    </article>
  </section>
</template>

<style scoped lang="scss">
.c1-dock-provisioning {
  --section-color: #0f766e;
}

.c1-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric-card {
  display: grid;
  gap: 5px;
  min-width: 0;

  span {
    color: var(--ble-subtle);
    font-size: 12px;
  }

  strong {
    overflow-wrap: anywhere;
    color: var(--ble-text);
    font-size: 14px;
  }
}

.c1-message {
  padding: 10px 12px;
  border: 1px solid var(--ble-border);
  border-radius: 6px;
  background: var(--ble-surface-soft);
  color: var(--ble-subtle);
  font-size: 13px;
  line-height: 1.5;
}

.c1-message[data-tone="success"] {
  border-color: rgba(22, 163, 74, 0.3);
  color: var(--ble-success);
}

.c1-message[data-tone="error"] {
  border-color: rgba(220, 38, 38, 0.3);
  color: var(--ble-danger);
}

.c1-request-row {
  grid-template-columns: minmax(260px, 1fr) auto auto;
  align-items: end;
}

.c1-scan-badge {
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--ble-surface-muted);
  color: var(--ble-subtle);
  font-size: 12px;
  font-weight: 800;
}

.c1-scan-badge[data-status="ok"] {
  color: var(--ble-success);
}

.c1-scan-badge[data-status="error"],
.c1-scan-badge[data-status="cancelled"] {
  color: var(--ble-danger);
}

.c1-scan-results {
  max-height: 380px;
  overflow: auto;
}

.c1-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.c1-table th,
.c1-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--ble-border-soft);
  text-align: left;
  vertical-align: middle;
}

.c1-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--ble-surface-soft);
  color: var(--ble-subtle);
}

.c1-table tr.is-selected td {
  background: rgba(15, 118, 110, 0.08);
}

.c1-table td:first-child {
  display: grid;
  gap: 2px;
}

.c1-table small,
.form-field small {
  color: var(--ble-subtle);
  font-size: 11px;
}

.c1-empty {
  padding: 24px;
  color: var(--ble-subtle);
  text-align: center;
}

@media (width <= 1100px) {
  .c1-status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (width <= 720px) {
  .c1-status-grid,
  .c1-request-row {
    grid-template-columns: 1fr;
  }
}
</style>
