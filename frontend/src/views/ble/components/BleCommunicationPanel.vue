<script setup lang="ts">
import { ref } from "vue";
import type { LegacyBridge } from "../types";
import BleLogPanel from "./BleLogPanel.vue";

defineOptions({
  name: "BleCommunicationPanel"
});

const props = defineProps<{
  bridge: LegacyBridge;
  focusedLogId: string | null;
}>();

const ntnStatusMetrics = [
  { label: "PM Mode", id: "ntnModeValue" },
  { label: "NTN State", id: "ntnStateValue" },
  { label: "Ready", id: "ntnReadyValue" },
  { label: "Last Error", id: "ntnErrValue" }
];

const esimStatusMetrics = [
  { label: "Status", id: "esimStatusValue" },
  { label: "Chunk", id: "esimChunkLimitValue" },
  { label: "Offset", id: "esimOffsetValue" },
  { label: "Result", id: "esimResultValue" }
];

const currentSmsId = ref(randomSmsId());

function randomSmsId(): number {
  return Math.floor(Math.random() * 65536);
}

function sendNtnSms(): void {
  const nextSmsId = randomSmsId();
  currentSmsId.value = nextSmsId;
  const idInput = document.getElementById("ntnSmsId") as HTMLInputElement | null;
  if (idInput) idInput.value = String(nextSmsId);
  props.bridge.call("handleNtnSmsSend");
}
</script>

<template>
  <section id="communicationSection" class="admin-section">
    <div class="section-heading">
      <p class="eyebrow">Communication</p>
      <h2>通讯</h2>
      <span>卫星短报文、NTN 模式、eSIM 下载和调试环境配置。</span>
    </div>

    <article id="ntnSmsSection" class="admin-card ntn-workspace">
      <div class="card-heading split ntn-heading">
        <div>
          <h3>卫星短报文 / NTN</h3>
          <p>把模式控制、链路状态、环境切换和短报文收发集中到一个通讯面板。</p>
        </div>
        <div id="ntnMessage" class="message-line"></div>
      </div>

      <div class="ntn-layout">
        <section class="ntn-panel ntn-status-panel">
          <div class="ntn-panel-title">
            <span>状态</span>
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call('handleNtnStatus')"
            >
              查询 NTN 状态
            </button>
          </div>

          <div id="ntnStatusDisplay" class="metric-grid ntn-metrics">
            <div
              v-for="metric in ntnStatusMetrics"
              :key="metric.id"
              class="metric-card"
            >
              <span>{{ metric.label }}</span>
              <strong :id="metric.id">-</strong>
            </div>
          </div>
        </section>

        <section class="ntn-panel">
          <div class="ntn-panel-title">
            <span>模式</span>
          </div>
          <div class="button-group ntn-mode-actions">
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call('handleNtnEnterOnlyMode')"
            >
              进入仅卫星模式
            </button>
            <button
              class="cmd cmd-button secondary"
              disabled
              @click="bridge.call('handleNtnExitOnlyMode')"
            >
              退出到默认模式
            </button>
          </div>
        </section>

        <section class="ntn-panel">
          <div class="metric-header ntn-env-header">
            <div>
              <strong>调试环境</strong>
              <span>生产环境 IP / 调试环境 IP</span>
            </div>
            <div id="ntnEnvValue" class="metric-value">-</div>
          </div>
          <div class="inline-controls">
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call('handleNtnEnvQuery')"
            >
              查询环境
            </button>
            <select
              id="ntnEnvSelect"
              class="cmd cmd-input admin-input narrow"
              disabled
            >
              <option value="0">生产环境 IP</option>
              <option value="1">调试环境 IP</option>
            </select>
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call('handleNtnEnvSet')"
            >
              设置环境
            </button>
          </div>
        </section>

        <section class="ntn-panel ntn-compose-panel">
          <div class="ntn-panel-title">
            <span>短报文发送</span>
          </div>
          <div class="ntn-sms-composer">
            <input id="ntnSmsId" type="hidden" :value="currentSmsId" />
            <div class="textarea-wrap">
              <textarea
                id="ntnSmsText"
                class="cmd cmd-input cmd-textarea admin-input"
                rows="4"
                maxlength="140"
                placeholder="卫星短报文文本，UTF-8 最大 140 字节"
                disabled
              ></textarea>
              <span><b id="ntnSmsByteCount">0</b>/140 bytes</span>
            </div>
            <div class="ntn-compose-footer">
              <p class="hint ntn-id-hint">
                调试：发送时自动生成消息 ID，当前准备使用
                <strong>{{ currentSmsId }}</strong>
              </p>
              <button
                class="cmd cmd-button ntn-send-button"
                disabled
                @click="sendNtnSms"
              >
                发送短报文
              </button>
            </div>
          </div>
        </section>
      </div>

      <div class="ntn-log-layout">
        <BleLogPanel
          title="NTN 短报文对话"
          panel-id="ntnConversationLog"
          size="chat"
          :focused-log-id="focusedLogId"
          :clear-panel="bridge.clearPanel"
          :focus-log="bridge.focusLog"
        />
        <div class="admin-grid two-columns slim-gap">
          <BleLogPanel
            title="NTN 命令日志"
            panel-id="ntnCmdRspLog"
            size="small"
            :focused-log-id="focusedLogId"
            :clear-panel="bridge.clearPanel"
            :focus-log="bridge.focusLog"
          />
          <BleLogPanel
            title="NTN 事件日志"
            panel-id="ntnEventLog"
            size="small"
            :focused-log-id="focusedLogId"
            :clear-panel="bridge.clearPanel"
            :focus-log="bridge.focusLog"
          />
        </div>
      </div>
    </article>

    <article id="esimDownloadSection" class="admin-card esim-workspace">
      <div class="card-heading split esim-heading">
        <div>
          <h3>eSIM 下发</h3>
          <p>启动 profile 下载，并自动处理中途的 HTTPS 请求与响应体分块回传。</p>
        </div>
        <div id="esimMessage" class="message-line"></div>
      </div>

      <div class="esim-layout">
        <section class="esim-panel esim-start-panel">
          <div class="esim-panel-title">
            <span>下载参数</span>
          </div>
          <div class="form-list">
            <label class="form-field">
              <span>激活码 AC</span>
              <div class="textarea-wrap">
                <textarea
                  id="esimActivationCode"
                  class="cmd cmd-input cmd-textarea admin-input"
                  rows="4"
                  maxlength="256"
                  placeholder="LPA 激活码"
                  disabled
                ></textarea>
                <span><b id="esimActivationByteCount">0</b>/256 bytes</span>
              </div>
            </label>
            <div class="inline-controls">
              <input
                id="esimConfirmationCode"
                type="text"
                class="cmd cmd-input admin-input"
                maxlength="40"
                placeholder="确认码 CC，可选"
                disabled
              />
              <button
                class="cmd cmd-button"
                disabled
                @click="bridge.call('handleEsimStart')"
              >
                开始下载
              </button>
              <button
                class="cmd cmd-button secondary"
                disabled
                @click="bridge.call('handleEsimCancel')"
              >
                取消
              </button>
            </div>
          </div>
        </section>

        <section class="esim-panel">
          <div class="esim-panel-title">
            <span>会话状态</span>
          </div>
          <div id="esimStatusDisplay" class="metric-grid esim-metrics">
            <div
              v-for="metric in esimStatusMetrics"
              :key="metric.id"
              class="metric-card"
            >
              <span>{{ metric.label }}</span>
              <strong :id="metric.id">-</strong>
            </div>
          </div>
        </section>

        <section class="esim-panel esim-list-panel">
          <div class="esim-panel-title">
            <span>Profile 列表</span>
            <button
              class="cmd cmd-button secondary"
              disabled
              @click="bridge.call('handleEsimList')"
            >
              刷新列表
            </button>
          </div>
          <div id="esimListResult" class="esim-list-result"></div>
        </section>
      </div>

      <div class="admin-grid three-columns slim-gap esim-log-layout">
        <BleLogPanel
          title="eSIM 命令日志"
          panel-id="esimCmdRspLog"
          size="small"
          :focused-log-id="focusedLogId"
          :clear-panel="bridge.clearPanel"
          :focus-log="bridge.focusLog"
        />
        <BleLogPanel
          title="eSIM 事件日志"
          panel-id="esimEventLog"
          size="small"
          :focused-log-id="focusedLogId"
          :clear-panel="bridge.clearPanel"
          :focus-log="bridge.focusLog"
        />
        <BleLogPanel
          title="eSIM HTTPS 日志"
          panel-id="esimHttpLog"
          size="small"
          :focused-log-id="focusedLogId"
          :clear-panel="bridge.clearPanel"
          :focus-log="bridge.focusLog"
        />
      </div>
    </article>
  </section>
</template>

<style scoped lang="scss">
.ntn-workspace {
  gap: 16px;
}

.ntn-heading {
  padding-bottom: 2px;
}

.ntn-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.4fr);
  gap: 14px;
  align-items: stretch;
}

.ntn-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--ble-border-soft);
  border-radius: 8px;
  background: var(--ble-surface-soft);
}

.ntn-status-panel,
.ntn-compose-panel {
  grid-column: span 2;
}

.ntn-panel-title {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;

  span {
    color: var(--ble-text);
    font-size: 14px;
    font-weight: 900;
  }
}

.ntn-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.ntn-mode-actions {
  align-items: stretch;
}

.ntn-env-header {
  align-items: flex-start;
}

.ntn-sms-composer {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.ntn-compose-footer {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.ntn-send-button {
  flex: 0 0 auto;
  min-width: 128px;
}

.ntn-id-hint {
  min-width: 0;
  margin: 0;

  strong {
    color: var(--ble-primary-deep);
    font-weight: 900;
  }
}

.ntn-log-layout {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.esim-workspace {
  order: -1;
  gap: 16px;
}

.esim-heading {
  padding-bottom: 2px;
}

.esim-layout {
  display: grid;
  grid-template-columns: minmax(280px, 1.1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
}

.esim-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--ble-border-soft);
  border-radius: 8px;
  background: var(--ble-surface-soft);
}

.esim-start-panel {
  grid-row: span 2;
}

.esim-panel-title {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;

  span {
    color: var(--ble-text);
    font-size: 14px;
    font-weight: 900;
  }
}

.esim-metrics {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.esim-list-panel {
  align-content: start;
}

.esim-list-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 88px;
  color: var(--ble-text-soft, #6b7280);
  font-size: 13px;
}

.esim-profile-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid var(--ble-border-soft);
  border-radius: 8px;
  background: var(--ble-surface, #fff);
}

.esim-profile-row.is-enabled {
  border-color: #16a34a;
  background: rgba(22, 163, 74, 0.06);
}

.esim-profile-main {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.esim-profile-state {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}

.esim-profile-state.is-on {
  background: #16a34a;
}

.esim-profile-state.is-off {
  background: #9ca3af;
}

.esim-profile-name {
  min-width: 0;
  font-weight: 700;
  color: var(--ble-text);
  word-break: break-all;
}

.esim-profile-iccid {
  margin-left: auto;
  padding-left: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--ble-text-soft, #6b7280);
  white-space: nowrap;
}

.esim-profile-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.esim-log-layout {
  min-width: 0;
}

@media (width <= 1280px) {
  .ntn-layout,
  .esim-layout,
  .ntn-status-panel,
  .ntn-compose-panel {
    grid-template-columns: 1fr;
    grid-column: auto;
  }

  .ntn-metrics,
  .esim-metrics {
    grid-template-columns: 1fr;
  }

  .esim-start-panel {
    grid-row: auto;
  }
}

@media (width <= 720px) {
  .ntn-compose-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .ntn-send-button {
    width: 100%;
    min-width: 0;
  }
}
</style>
