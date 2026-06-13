<script setup lang="ts">
import type { LegacyBridge } from "../types";

defineOptions({
  name: "BleEventSidebar"
});

defineProps<{
  bridge: LegacyBridge;
  focusedLogId: string | null;
}>();
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
        <span class="event-live-dot"></span>
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
      </div>

      <div
        id="eventMessagesLog"
        class="log-panel event-log"
        :class="{ 'is-focused': focusedLogId === 'eventMessagesLog' }"
      ></div>
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
        <button type="button" @click="bridge.focusLog('wifiCmdRspLog')">
          Wi-Fi 日志
        </button>
      </div>
    </section>
  </aside>
</template>
