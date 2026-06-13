<script setup lang="ts">
import type { LegacyBridge } from "../types";
import BleLogPanel from "./BleLogPanel.vue";

defineOptions({
  name: "BleCommandPanel"
});

defineProps<{
  bridge: LegacyBridge;
  focusedLogId: string | null;
}>();

const appQuickCommands = [
  { label: "查询版本号", command: '{"c":"v"}' },
  { label: "查询电量", command: '{"c":"b"}' },
  { label: "查围栏状态", command: '{"c":"f"}' },
  { label: "开启围栏", command: '{"c":"f1"}' },
  { label: "关闭围栏", command: '{"c":"f0"}', tone: "secondary" },
  { label: "查激活围栏", command: '{"c":"fe"}' },
  { label: "查围栏列表", command: '{"c":"fl"}' },
  { label: "查询时间", command: '{"c":"st"}' },
  { label: "片内查询目录", command: '{"c":"dir"}' },
  { label: "查询剩余空间", command: '{"c":"ss"}' },
  { label: "查询设备信息", command: '{"c":"di"}' },
  { label: "重启设备", command: '{"c":"sys.reboot"}', tone: "warning" },
  { label: "船运模式", command: '{"c":"sys.poweroff"}', tone: "warning" },
  { label: "Info Dump", command: '{"c":"?"}' },
  { label: "格式化 Flash", command: '{"c":"sec.format"}', tone: "danger" },
  { label: "重置 Setting", command: '{"c":"settings.format"}', tone: "danger" }
];
</script>

<template>
  <section id="commandConsoleSection" class="admin-section">
    <div class="section-heading">
      <p class="eyebrow">Command Center</p>
      <h2>命令控制台</h2>
      <span>NUS 自定义命令与 APP 快捷 JSON 命令。</span>
    </div>

    <div class="admin-grid">
      <article class="admin-card">
        <div class="card-heading">
          <div>
            <h3>自定义命令</h3>
            <p>按回车发送，响应会写入下方日志。</p>
          </div>
        </div>

        <div class="form-list">
          <label class="form-field">
            <span>NUS 命令</span>
            <input
              id="customCmd"
              type="text"
              placeholder="输入自定义命令并按回车"
              class="cmd cmd-input admin-input"
              disabled
            />
          </label>
          <label class="switch-line">
            <input id="clearOnSent" type="checkbox" checked class="cmd" disabled />
            <span>自动添加 \r\n</span>
          </label>
          <label class="form-field">
            <span>APP 命令</span>
            <input
              id="appCmd"
              type="text"
              placeholder="输入 APP 命令并按回车"
              class="cmd cmd-input admin-input"
              disabled
            />
          </label>
          <BleLogPanel
            title="命令响应"
            panel-id="customCmdRsp"
            size="small"
            :focused-log-id="focusedLogId"
            :clear-panel="bridge.clearPanel"
            :focus-log="bridge.focusLog"
          />
        </div>
      </article>
    </div>

    <article class="admin-card">
      <div class="card-heading">
        <div>
          <h3>APP 快捷命令</h3>
          <p>高频 APP JSON 命令集中入口。</p>
        </div>
      </div>
      <div class="button-grid">
        <button
          v-for="item in appQuickCommands"
          :key="item.command"
          class="cmd cmd-button"
          :class="item.tone"
          disabled
          @click="bridge.sendAppCommand(item.command)"
        >
          {{ item.label }}
        </button>
      </div>
      <BleLogPanel
        title="APP 命令响应"
        panel-id="appCmdRspLog"
        size="medium"
        :focused-log-id="focusedLogId"
        :clear-panel="bridge.clearPanel"
        :focus-log="bridge.focusLog"
      />
    </article>
  </section>
</template>
