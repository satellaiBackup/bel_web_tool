<script setup lang="ts">
import { nextTick } from "vue";
import { getNextTabIndex } from "../safetyState";
import type { ModuleId, ModuleTab } from "../types";

defineOptions({
  name: "BleModuleTabs"
});

const props = defineProps<{
  activeModule: ModuleTab;
  activeModuleId: ModuleId;
  tabs: ModuleTab[];
}>();

const emit = defineEmits<{
  select: [moduleId: ModuleId];
  focusCommand: [inputId: "customCmd" | "appCmd"];
}>();

function tabId(moduleId: ModuleId): string {
  return `module-tab-${moduleId}`;
}

async function handleTabKeydown(
  event: KeyboardEvent,
  currentIndex: number
): Promise<void> {
  const nextIndex = getNextTabIndex(currentIndex, event.key, props.tabs.length);
  if (nextIndex === null) return;
  event.preventDefault();
  const nextTab = props.tabs[nextIndex];
  emit("select", nextTab.id);
  await nextTick();
  document.getElementById(tabId(nextTab.id))?.focus();
}
</script>

<template>
  <div class="interaction-bar">
    <div class="interaction-current">
      <span class="eyebrow">Current Module</span>
      <strong>{{ activeModule.title }}</strong>
      <small>{{ activeModule.description }}</small>
    </div>
    <div class="module-tabs" role="tablist" aria-label="工作台模块">
      <button
        v-for="(tab, index) in tabs"
        :id="tabId(tab.id)"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeModuleId === tab.id"
        :aria-controls="tab.id"
        :tabindex="activeModuleId === tab.id ? 0 : -1"
        :class="{ 'is-active': activeModuleId === tab.id }"
        @click="emit('select', tab.id)"
        @keydown="handleTabKeydown($event, index)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="quick-actions">
      <button
        type="button"
        class="cmd-button secondary"
        @click="emit('focusCommand', 'customCmd')"
      >
        NUS 输入
      </button>
      <button
        type="button"
        class="cmd-button secondary"
        @click="emit('focusCommand', 'appCmd')"
      >
        APP 输入
      </button>
    </div>
  </div>
</template>
