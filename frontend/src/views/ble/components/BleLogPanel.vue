<script setup lang="ts">
import { ref } from "vue";
import { prepareLogForOutput } from "../safetyState";

defineOptions({
  name: "BleLogPanel"
});

const props = defineProps<{
  title: string;
  panelId: string;
  size?: "small" | "medium" | "chat" | "event-log";
  focusedLogId: string | null;
  clearPanel: (id: string) => void;
  focusLog: (id: string) => void;
}>();

const actionStatus = ref("");

function safePanelText(): string {
  return prepareLogForOutput(
    document.getElementById(props.panelId)?.textContent || ""
  );
}

async function copyLog(): Promise<void> {
  try {
    await navigator.clipboard.writeText(safePanelText());
    actionStatus.value = "已复制脱敏日志";
  } catch {
    actionStatus.value = "复制失败，请检查剪贴板权限";
  }
}

function exportLog(): void {
  const blob = new Blob([safePanelText()], {
    type: "text/plain;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${props.panelId}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  link.click();
  URL.revokeObjectURL(url);
  actionStatus.value = "已导出脱敏日志";
}
</script>

<template>
  <div>
    <div class="log-toolbar">
      <div class="log-title">{{ title }}</div>
      <div class="log-actions">
        <button type="button" @click="clearPanel(panelId)">清空</button>
        <button type="button" @click="focusLog(panelId)">聚焦</button>
        <button type="button" @click="copyLog">复制</button>
        <button type="button" @click="exportLog">导出</button>
      </div>
    </div>
    <span class="sr-only" role="status" aria-live="polite">
      {{ actionStatus }}
    </span>
    <div
      :id="panelId"
      class="log-panel"
      role="log"
      aria-live="off"
      :aria-label="title"
      :class="[size ?? 'small', { 'is-focused': focusedLogId === panelId }]"
    />
  </div>
</template>
