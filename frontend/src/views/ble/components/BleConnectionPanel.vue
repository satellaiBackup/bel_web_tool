<script setup lang="ts">
import type { LegacyBridge } from "../types";

defineOptions({
  name: "BleConnectionPanel"
});

defineProps<{
  bridge: LegacyBridge;
}>();
</script>

<template>
  <section id="connectionSection" class="admin-hero">
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
        <span class="status-dot"></span>
        <label id="status">待连接</label>
      </div>
      <div class="connection-controls ble-connection-controls">
        <label class="form-field">
          <span>名称前缀</span>
          <input
            id="nameFilter"
            type="text"
            placeholder="设备名称前缀，例如 SATELLAI"
            class="admin-input"
          />
        </label>
        <label class="form-field form-field-wide">
          <span>设备列表</span>
          <select id="deviceSelect" class="admin-input">
            <option value="">请先扫描设备</option>
          </select>
        </label>
        <div class="action-stack connection-action-stack">
          <button
            id="scanDevices"
            type="button"
            class="cmd-button"
            data-vue-action="true"
            @click="bridge.call('scanBleDevices')"
          >
            扫描设备
          </button>
          <button
            id="scanAndConnect"
            type="button"
            class="cmd-button"
            data-vue-action="true"
            @click="bridge.call('connectSelectedDevice')"
          >
            连接设备
          </button>
          <button
            id="disconnect"
            type="button"
            class="cmd-button danger"
            data-vue-action="true"
            hidden
            @click="bridge.call('disconnectBleDevice')"
          >
            断开连接
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
