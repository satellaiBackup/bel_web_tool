<script setup lang="ts">
import { computed, ref } from "vue";
import type { LegacyBridge } from "../types";
import BleLogPanel from "./BleLogPanel.vue";

defineOptions({
  name: "BleCommandPanel"
});

defineProps<{
  bridge: LegacyBridge;
  focusedLogId: string | null;
}>();

const appQuickCommandGroups = [
  {
    id: "status",
    label: "常用查询",
    description: "设备、网络、定位和运行模式",
    commands: [
      { label: "查询版本号", command: '{"c":"v"}' },
      { label: "查询电量", command: '{"c":"b"}' },
      { label: "查询设备信息", command: '{"c":"di"}' },
      { label: "查询网络状态", command: '{"c":"network.status"}' },
      { label: "查询 GNSS 状态", command: '{"c":"g"}' },
      { label: "查询省电模式", command: '{"c":"power_saving"}' },
      { label: "查询运行态汇总", command: '{"c":"?"}' }
    ]
  },
  {
    id: "fence",
    label: "围栏",
    description: "查询围栏列表和当前激活项",
    commands: [
      { label: "查询围栏列表", command: '{"c":"fl"}' },
      { label: "查询激活围栏", command: '{"c":"fe"}' },
      { label: "清空全部围栏", command: '{"c":"fc"}', tone: "danger" }
    ]
  },
  {
    id: "system",
    label: "系统与存储",
    description: "会改变设备状态，请确认后执行",
    commands: [
      { label: "输出设置日志", command: '{"c":"sd"}', tone: "secondary" },
      { label: "重启设备", command: '{"c":"sys.reboot"}', tone: "warning" },
      { label: "船运模式", command: '{"c":"sys.poweroff"}', tone: "warning" },
      { label: "格式化 Flash", command: '{"c":"sec.format"}', tone: "danger" },
      {
        label: "恢复出厂设置",
        command: '{"c":"factory-reset"}',
        tone: "danger"
      }
    ]
  }
];

const activeQuickCommandGroupId = ref(appQuickCommandGroups[0].id);
const activeQuickCommandGroup = computed(
  () =>
    appQuickCommandGroups.find(
      group => group.id === activeQuickCommandGroupId.value
    ) ?? appQuickCommandGroups[0]
);
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
          <p>D1、S1、T1 均支持的无参数 JSON 命令。</p>
        </div>
      </div>
      <div class="quick-command-browser">
        <div
          class="quick-command-tabs"
          role="tablist"
          aria-label="快捷命令分类"
        >
          <button
            v-for="group in appQuickCommandGroups"
            :id="`quick-command-tab-${group.id}`"
            :key="group.id"
            type="button"
            role="tab"
            class="quick-command-tab"
            :class="{ 'is-active': activeQuickCommandGroupId === group.id }"
            :aria-selected="activeQuickCommandGroupId === group.id"
            :aria-controls="`quick-command-panel-${group.id}`"
            @click="activeQuickCommandGroupId = group.id"
          >
            {{ group.label }}
            <span>{{ group.commands.length }}</span>
          </button>
        </div>
        <div
          :id="`quick-command-panel-${activeQuickCommandGroup.id}`"
          class="quick-command-panel"
          role="tabpanel"
          :aria-labelledby="`quick-command-tab-${activeQuickCommandGroup.id}`"
        >
          <p>{{ activeQuickCommandGroup.description }}</p>
          <div class="button-grid">
            <button
              v-for="item in activeQuickCommandGroup.commands"
              :key="item.command"
              class="cmd cmd-button"
              :class="item.tone"
              :title="item.command"
              disabled
              @click="bridge.sendAppCommand(item.command)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
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
