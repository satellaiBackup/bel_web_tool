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
      <span>卫星短报文、NTN 模式、状态查询和调试环境配置。</span>
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

@media (width <= 1280px) {
  .ntn-layout,
  .ntn-status-panel,
  .ntn-compose-panel {
    grid-template-columns: 1fr;
    grid-column: auto;
  }

  .ntn-metrics {
    grid-template-columns: 1fr;
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
