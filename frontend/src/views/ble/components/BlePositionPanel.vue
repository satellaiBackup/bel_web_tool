<script setup lang="ts">
import type { LegacyBridge } from "../types";

defineOptions({
  name: "BlePositionPanel"
});

defineProps<{
  bridge: LegacyBridge;
}>();
</script>

<template>
  <section
    id="positioningSection"
    class="admin-section"
    data-ble-requires="app"
  >
    <div class="section-heading">
      <p class="eyebrow">Positioning</p>
      <h2>定位</h2>
      <span>围栏激活、编辑、删除、参数配置和 GNSS 调试事件。</span>
    </div>

    <article class="admin-card">
      <div class="card-heading">
        <div>
          <h3>围栏管理</h3>
          <p>围栏激活、禁用、添加、删除和调试事件。</p>
        </div>
      </div>

      <div class="admin-grid two-columns">
        <div class="sub-card">
          <h4>激活 / 禁用围栏</h4>
          <div class="inline-controls">
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call('handleAppActivateFence')"
            >
              激活围栏
            </button>
            <input
              id="app_fe1_param_fid"
              type="text"
              placeholder="围栏 ID，例如 f-1234"
              class="cmd cmd-input admin-input"
              disabled
            />
          </div>
          <div class="inline-controls">
            <button
              class="cmd cmd-button secondary"
              disabled
              @click="bridge.call('handleAppDeactivateFence')"
            >
              禁用围栏
            </button>
            <input
              id="app_fe0_param_fid"
              type="text"
              placeholder="围栏 ID，例如 f-1234"
              class="cmd cmd-input admin-input"
              disabled
            />
          </div>
        </div>

        <div class="sub-card">
          <h4>删除围栏</h4>
          <div class="inline-controls">
            <button
              class="cmd cmd-button danger"
              disabled
              @click="bridge.call('handleAppDeleteFence')"
            >
              删除围栏
            </button>
            <input
              id="app_fd_param_fids"
              type="text"
              placeholder="围栏 ID 列表，逗号分隔，例如 f-1,f-2"
              class="cmd cmd-input admin-input"
              disabled
            />
          </div>
        </div>
      </div>

      <div class="sub-card">
        <h4>围栏编辑器</h4>
        <iframe
          id="fenceEditorFrame"
          src="gps.html"
          class="tool-overlay-frame fence-editor-frame"
        ></iframe>
        <button
          id="openEditorBtn"
          class="cmd cmd-button"
          disabled
          @click="bridge.call('openFenceEditor')"
        >
          打开围栏编辑器
        </button>
        <div id="dataList" class="data-preview">
          <p>尚未接收到数据。请打开编辑器并提交一个围栏。</p>
        </div>
      </div>

      <div class="admin-grid two-columns">
        <div class="sub-card">
          <h4>围栏参数</h4>
          <div class="inline-controls">
            <input
              id="app_sfp1_padding"
              type="number"
              step="any"
              placeholder="Padding"
              class="cmd cmd-input admin-input narrow"
              disabled
            />
            <input
              id="app_sfp1_margin"
              type="number"
              step="any"
              placeholder="Margin"
              class="cmd cmd-input admin-input narrow"
              disabled
            />
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call('handleAppSetFenceParams')"
            >
              设置参数
            </button>
          </div>
        </div>

        <div class="sub-card">
          <h4>围栏事件调试</h4>
          <div class="inline-controls">
            <input
              id="app_debug_event_type"
              type="number"
              min="1"
              max="6"
              placeholder="Type 1-6"
              class="cmd cmd-input admin-input narrow"
              disabled
            />
            <input
              id="app_debug_event_lat"
              type="number"
              step="any"
              placeholder="Latitude"
              class="cmd cmd-input admin-input"
              disabled
            />
            <input
              id="app_debug_event_lng"
              type="number"
              step="any"
              placeholder="Longitude"
              class="cmd cmd-input admin-input"
              disabled
            />
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call('handleAppDebugEventGnss')"
            >
              发送调试事件
            </button>
          </div>
          <p class="hint">
            Type: 1 lost, 2 fix, 3 secured, 4 approaching, 5 breach, 6 escaped
          </p>
        </div>
      </div>
    </article>
  </section>
</template>
