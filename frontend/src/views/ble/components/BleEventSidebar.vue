<script setup lang="ts">
import { ref } from "vue";
import { prepareLogForOutput } from "../safetyState";
import type { SafetyStreamState } from "../safetyState";
import type { LegacyBridge } from "../types";

defineOptions({
  name: "BleEventSidebar"
});

defineProps<{
  bridge: LegacyBridge;
  focusedLogId: string | null;
  eventStreamState: SafetyStreamState;
}>();

const streamLabels: Record<SafetyStreamState, string> = {
  connecting: "连接中",
  fresh: "已对账",
  reconnecting: "重连中",
  stale: "已过期",
  snapshot_syncing: "对账中",
  failed: "不可用"
};

const actionStatus = ref("");

function safeEventLogText(): string {
  return prepareLogForOutput(
    document.getElementById("eventMessagesLog")?.textContent || ""
  );
}

async function copyEventLog(): Promise<void> {
  try {
    await navigator.clipboard.writeText(safeEventLogText());
    actionStatus.value = "已复制脱敏事件日志";
  } catch {
    actionStatus.value = "复制失败，请检查剪贴板权限";
  }
}

function exportEventLog(): void {
  const blob = new Blob([safeEventLogText()], {
    type: "text/plain;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `eventMessagesLog-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  link.click();
  URL.revokeObjectURL(url);
  actionStatus.value = "已导出脱敏事件日志";
}
</script>

<template>
  <aside class="event-sidebar" aria-label="事件与日志侧栏">
    <section id="eventMessagesSection" class="event-card event-card-primary">
      <div class="event-sidebar-header">
        <div>
          <span class="eyebrow">Live Events</span>
          <h2>事件消息</h2>
          <p>设备上报的 <code>{"e":"xxxxx"}</code> 事件会持续写入这里。</p>
        </div>
        <span
          class="event-live-state"
          :data-state="eventStreamState"
          role="status"
        >
          {{ streamLabels[eventStreamState] }}
        </span>
      </div>

      <div class="event-toolbar">
        <button
          id="clearEventMessages"
          class="cmd-button secondary"
          type="button"
          @click="bridge.call('clearEventMessages')"
        >
          清空
        </button>
        <button
          class="cmd-button secondary"
          type="button"
          @click="bridge.focusLog('eventMessagesLog')"
        >
          聚焦
        </button>
        <button
          class="cmd-button secondary"
          type="button"
          @click="copyEventLog"
        >
          复制
        </button>
        <button
          class="cmd-button secondary"
          type="button"
          @click="exportEventLog"
        >
          导出
        </button>
      </div>

      <span class="sr-only" role="status" aria-live="polite">
        {{ actionStatus }}
      </span>

      <div
        id="eventMessagesLog"
        class="log-panel event-log"
        role="log"
        aria-live="off"
        aria-label="设备事件消息"
        :class="{ 'is-focused': focusedLogId === 'eventMessagesLog' }"
      />
    </section>

    <section class="event-card">
      <div class="side-section-heading">
        <h3>日志面板</h3>
        <p>把常用响应面板拉到前台查看。</p>
      </div>
      <div class="side-log-grid">
        <button type="button" @click="bridge.focusLog('customCmdRsp')">
          NUS 响应
        </button>
        <button type="button" @click="bridge.focusLog('appCmdRspLog')">
          APP 响应
        </button>
        <button type="button" @click="bridge.focusLog('ntnConversationLog')">
          NTN 对话
        </button>
        <button type="button" @click="bridge.focusLog('esimCmdRspLog')">
          eSIM 命令
        </button>
        <button type="button" @click="bridge.focusLog('esimHttpLog')">
          eSIM HTTPS
        </button>
        <button type="button" @click="bridge.focusLog('wifiCmdRspLog')">
          Wi-Fi 日志
        </button>
      </div>
    </section>
  </aside>
</template>
