<script setup lang="ts">
import { computed } from "vue";
import {
  getBleConnectionControls,
  getBleSubscriptionProgress,
  type BleConnectionState
} from "../connectionState";
import type { LegacyBridge } from "../types";

defineOptions({
  name: "BleConnectionPanel"
});

const props = defineProps<{
  bridge: LegacyBridge;
  state: BleConnectionState;
}>();

const controls = computed(() => getBleConnectionControls(props.state));
const subscriptionProgress = computed(() =>
  getBleSubscriptionProgress(props.state)
);
</script>

<template>
  <section
    id="connectionSection"
    class="admin-hero"
    :data-ble-state="state.phase"
    :data-event-stream-state="state.eventStream"
    :aria-busy="controls.busy"
  >
    <div class="hero-copy">
      <div class="admin-brand compact-brand">
        <div class="admin-brand-mark">BLE</div>
        <div>
          <h1>BLE 调试工作台</h1>
          <p>连接后按设备实际通道能力启用调试功能</p>
        </div>
      </div>
      <p class="eyebrow">Device Console</p>
      <h2>设备连接</h2>
      <p>扫描、选择并建立 BLE 会话，连接成功后启用命令、文件和业务调试能力。</p>
    </div>

    <div class="connection-panel">
      <div class="connection-status">
        <span class="status-dot" :data-state="state.phase" />
        <label id="status" role="status" aria-live="polite">
          {{ state.statusText }}
        </label>
      </div>
      <div
        v-if="state.phase === 'subscribing'"
        class="subscription-progress"
        aria-label="BLE 通知订阅进度"
      >
        <div class="subscription-progress-heading" role="status" aria-live="polite">
          <span class="subscription-spinner" aria-hidden="true" />
          <strong>
            {{
              subscriptionProgress.activeLabel
                ? `正在订阅 ${subscriptionProgress.activeLabel} 通知`
                : "正在确认通知订阅结果"
            }}
          </strong>
          <span>
            {{ subscriptionProgress.completed }}/{{ subscriptionProgress.total }}
          </span>
        </div>
        <div class="subscription-progress-track" aria-hidden="true">
          <span :style="{ width: `${subscriptionProgress.percent}%` }" />
        </div>
        <ol class="subscription-progress-steps">
          <li
            v-for="item in subscriptionProgress.items"
            :key="item.name"
            class="subscription-progress-step"
            :data-status="item.active ? 'active' : item.status"
            :aria-current="item.active ? 'step' : undefined"
            :title="item.error"
          >
            <span class="subscription-step-icon" aria-hidden="true">
              <span
                v-if="item.active"
                class="subscription-spinner subscription-spinner-small"
              />
              <span v-else>{{ item.icon }}</span>
            </span>
            <span>{{ item.label }}</span>
            <strong>{{ item.statusText }}</strong>
          </li>
        </ol>
      </div>
      <div v-if="state.error" class="connection-error" role="alert">
        {{ state.error }}
      </div>
      <div class="connection-controls ble-connection-controls">
        <label class="form-field">
          <span>名称前缀</span>
          <input
            id="nameFilter"
            type="text"
            placeholder="设备名称前缀，例如 SATELLAI"
            class="admin-input"
            :disabled="controls.filtersDisabled"
          />
        </label>
        <label class="form-field form-field-wide">
          <span>设备列表</span>
          <select
            id="deviceSelect"
            class="admin-input"
            :disabled="controls.filtersDisabled || state.scanCount === 0"
          >
            <option value="">请先扫描设备</option>
          </select>
        </label>
        <div class="action-stack connection-action-stack">
          <button
            id="scanDevices"
            type="button"
            class="cmd-button"
            data-vue-action="true"
            :disabled="controls.scanDisabled"
            :aria-busy="state.phase === 'scanning'"
            @click="bridge.call('scanBleDevices')"
          >
            {{ controls.scanLabel }}
          </button>
          <button
            id="scanAndConnect"
            type="button"
            class="cmd-button"
            data-vue-action="true"
            :disabled="controls.connectDisabled"
            :aria-busy="state.phase === 'connecting'"
            @click="bridge.call('connectSelectedDevice')"
          >
            连接设备
          </button>
          <button
            v-show="controls.disconnectVisible"
            id="disconnect"
            type="button"
            class="cmd-button danger"
            data-vue-action="true"
            :disabled="controls.disconnectDisabled"
            :aria-busy="state.phase === 'disconnecting'"
            @click="bridge.call('disconnectBleDevice')"
          >
            断开连接
          </button>
          <button
            v-show="controls.reconnectVisible"
            id="reconnect"
            type="button"
            class="cmd-button"
            data-vue-action="true"
            :disabled="controls.reconnectDisabled"
            :aria-busy="state.phase === 'reconnecting'"
            @click="bridge.call('reconnectLastBleDevice')"
          >
            重新连接
          </button>
        </div>
      </div>
      <div id="deviceSummary" class="connection-summary">
        请先扫描设备，列表会显示名称、MAC 和 RSSI。
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.ble-connection-controls {
  grid-template-columns:
    minmax(150px, 0.62fr)
    minmax(220px, 1fr)
    minmax(320px, 0.82fr);
}

.subscription-progress {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(37, 99, 235, 0.2);
  border-radius: 8px;
  background: rgba(239, 246, 255, 0.72);
}

.subscription-progress-heading {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--ble-primary-deep);
  font-size: 13px;

  strong {
    flex: 1;
  }
}

.subscription-spinner {
  display: inline-block;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(37, 99, 235, 0.2);
  border-top-color: var(--ble-primary);
  border-radius: 50%;
  animation: subscription-spin 0.75s linear infinite;
}

.subscription-spinner-small {
  width: 12px;
  height: 12px;
}

.subscription-progress-track {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.12);

  span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--ble-primary);
    transition: width 180ms ease;
  }
}

.subscription-progress-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.subscription-progress-step {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 5px;
  align-items: center;
  min-width: 0;
  color: var(--ble-subtle);
  font-size: 12px;

  > span:nth-child(2) {
    overflow: hidden;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 11px;
    white-space: nowrap;
  }
}

.subscription-step-icon {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  background: var(--ble-surface);
  font-weight: 900;
}

.subscription-progress-step[data-status="active"] {
  color: var(--ble-primary-deep);
}

.subscription-progress-step[data-status="ready"] {
  color: var(--ble-success);
}

.subscription-progress-step[data-status="failed"] {
  color: var(--ble-danger);
}

.subscription-progress-step[data-status="unsupported"] {
  color: var(--ble-amber);
}

@keyframes subscription-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .subscription-spinner {
    animation-duration: 1.8s;
  }

  .subscription-progress-track span {
    transition: none;
  }
}

.connection-action-stack {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  align-items: end;
  justify-content: stretch;
  min-width: 0;

  .cmd-button {
    width: 100%;
    min-height: 36px;
    padding-inline: 10px;
    white-space: nowrap;
  }
}

@media (width <= 1500px) {
  .ble-connection-controls {
    grid-template-columns: minmax(150px, 0.62fr) minmax(220px, 1fr);
  }

  .connection-action-stack {
    grid-column: 1 / -1;
  }
}

@media (width <= 720px) {
  .ble-connection-controls,
  .connection-action-stack {
    grid-template-columns: 1fr;
  }

  .subscription-progress-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
