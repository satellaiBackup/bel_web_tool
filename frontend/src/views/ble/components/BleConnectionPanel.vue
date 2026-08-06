<script setup lang="ts">
import { computed } from "vue";
import {
  getBleConnectionControls,
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
          <p>SATELLAI 设备 · 固件 <b>v8.1.0+</b></p>
        </div>
      </div>
      <p class="eyebrow">Device Console</p>
      <h2>设备连接</h2>
      <p>扫描、选择并建立 BLE 会话，连接成功后启用命令、文件和业务调试能力。</p>
    </div>

    <div class="connection-panel">
      <div class="connection-status">
        <span class="status-dot" :data-state="state.phase"></span>
        <label id="status" role="status" aria-live="polite">
          {{ state.statusText }}
        </label>
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
            id="disconnect"
            type="button"
            class="cmd-button danger"
            data-vue-action="true"
            v-show="controls.disconnectVisible"
            :disabled="controls.disconnectDisabled"
            :aria-busy="state.phase === 'disconnecting'"
            @click="bridge.call('disconnectBleDevice')"
          >
            断开连接
          </button>
          <button
            id="reconnect"
            type="button"
            class="cmd-button"
            data-vue-action="true"
            v-show="controls.reconnectVisible"
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
}
</style>
