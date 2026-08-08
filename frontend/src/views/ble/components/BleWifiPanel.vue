<script setup lang="ts">
import type { LegacyBridge } from "../types";
import BleLogPanel from "./BleLogPanel.vue";

defineOptions({
  name: "BleWifiPanel"
});

defineProps<{
  bridge: LegacyBridge;
  focusedLogId: string | null;
}>();

const wifiResultPanels = [
  {
    title: "当前 Wi-Fi 状态",
    action: "查询状态",
    handler: "handleWifiStatus",
    targetId: "wifiStatusDisplay"
  },
  {
    title: "最近扫描结果",
    action: "触发扫描",
    handler: "handleWifiScan",
    targetId: "wifiScanResults"
  },
  {
    title: "已保存的信标",
    action: "查询列表",
    handler: "handleWifiQueryTags",
    targetId: "wifiTagList"
  }
];
</script>

<template>
  <section
    id="wifiCommandsSection"
    class="admin-section"
    data-ble-requires="app"
  >
    <div class="section-heading">
      <p class="eyebrow">Wi-Fi Beacon</p>
      <h2>Wi-Fi 信标工具</h2>
      <span>配置扫描策略，维护信标列表，并查看扫描结果。</span>
    </div>

    <article class="admin-card">
      <div class="card-heading split">
        <div>
          <h3>信标配置</h3>
          <p>扫描频率和丢失阈值会用于信标丢失判断。</p>
        </div>
        <div id="wifiMessage" class="message-line"></div>
      </div>

      <div class="admin-grid two-columns">
        <div class="sub-card">
          <h4>参数</h4>
          <div class="inline-controls">
            <label class="mini-field" for="wifiScanFrequency">扫描频率</label>
            <input
              id="wifiScanFrequency"
              type="number"
              class="cmd cmd-input admin-input narrow"
              placeholder="60"
              min="30"
              value="60"
              disabled
              title="最小 30 秒"
            />
            <span class="unit">秒</span>
            <label class="mini-field" for="wifiLostCount">丢失阈值</label>
            <input
              id="wifiLostCount"
              type="number"
              class="cmd cmd-input admin-input narrow"
              placeholder="1"
              min="1"
              value="1"
              disabled
              title="至少 1 次"
            />
            <span class="unit">次</span>
          </div>
          <p class="hint">
            f 为扫描频率，l 为连续未检测到信标的次数阈值。
          </p>
        </div>

        <div class="sub-card">
          <h4>开关</h4>
          <div class="button-group">
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call('handleWifiEnable')"
            >
              开启信标
            </button>
            <button
              class="cmd cmd-button secondary"
              disabled
              @click="bridge.call('handleWifiDisable')"
            >
              关闭信标
            </button>
          </div>
        </div>
      </div>

      <div class="admin-grid two-columns">
        <div class="sub-card">
          <h4>添加 Wi-Fi 信标</h4>
          <div class="form-list">
            <div class="inline-controls">
              <input
                id="wifiAddSsid"
                type="text"
                class="cmd cmd-input admin-input"
                placeholder="SSID"
                disabled
              />
              <input
                id="wifiAddMac"
                type="text"
                class="cmd cmd-input admin-input"
                placeholder="MAC 地址，例如 12:34:56:78:9A:BC"
                disabled
              />
              <button
                class="cmd cmd-button"
                disabled
                @click="bridge.call('handleWifiAddTag')"
              >
                添加
              </button>
            </div>
            <div class="inline-controls">
              <input
                id="wifiAddLat"
                type="number"
                class="cmd cmd-input admin-input"
                min="-90"
                max="90"
                step="0.000001"
                placeholder="纬度 lat，可选"
                disabled
              />
              <input
                id="wifiAddLng"
                type="number"
                class="cmd cmd-input admin-input"
                min="-180"
                max="180"
                step="0.000001"
                placeholder="经度 lng，可选"
                disabled
              />
              <button
                class="cmd cmd-button secondary"
                disabled
                @click="bridge.call('openWifiLocationPicker')"
              >
                地图选点
              </button>
              <button
                class="cmd cmd-button secondary"
                disabled
                @click="bridge.call('clearWifiLocation')"
              >
                清除位置
              </button>
            </div>
            <div id="wifiLocationHint" class="hint">
              经纬度为可选项；留空时只提交 SSID 和 MAC。
            </div>
            <iframe
              id="wifiLocationPickerFrame"
              src="about:blank"
              title="Wi-Fi 信标地图选点"
              class="tool-overlay-frame wifi-picker-frame"
            ></iframe>
          </div>
        </div>

        <div class="sub-card">
          <h4>删除 Wi-Fi 信标</h4>
          <div class="inline-controls">
            <input
              id="wifiDeleteMac"
              type="text"
              class="cmd cmd-input admin-input"
              placeholder="MAC 地址"
              disabled
            />
            <button
              class="cmd cmd-button danger"
              disabled
              @click="bridge.call('handleWifiDeleteTag')"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <div class="admin-grid three-columns">
        <div
          v-for="panel in wifiResultPanels"
          :key="panel.targetId"
          class="sub-card"
        >
          <div class="card-heading compact-heading">
            <h4>{{ panel.title }}</h4>
            <button
              class="cmd cmd-button"
              disabled
              @click="bridge.call(panel.handler)"
            >
              {{ panel.action }}
            </button>
          </div>
          <div :id="panel.targetId" class="result-panel"></div>
        </div>
      </div>

      <BleLogPanel
        title="Wi-Fi 命令日志"
        panel-id="wifiCmdRspLog"
        size="medium"
        :focused-log-id="focusedLogId"
        :clear-panel="bridge.clearPanel"
        :focus-log="bridge.focusLog"
      />
    </article>
  </section>
</template>
