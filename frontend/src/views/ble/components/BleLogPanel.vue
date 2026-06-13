<script setup lang="ts">
defineOptions({
  name: "BleLogPanel"
});

defineProps<{
  title: string;
  panelId: string;
  size?: "small" | "medium" | "chat" | "event-log";
  focusedLogId: string | null;
  clearPanel: (id: string) => void;
  focusLog: (id: string) => void;
}>();
</script>

<template>
  <div>
    <div class="log-toolbar">
      <div class="log-title">{{ title }}</div>
      <div class="log-actions">
        <button type="button" @click="clearPanel(panelId)">清空</button>
        <button type="button" @click="focusLog(panelId)">聚焦</button>
      </div>
    </div>
    <div
      :id="panelId"
      class="log-panel"
      :class="[size ?? 'small', { 'is-focused': focusedLogId === panelId }]"
    ></div>
  </div>
</template>
