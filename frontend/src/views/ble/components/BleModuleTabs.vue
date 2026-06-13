<script setup lang="ts">
import type { ModuleId, ModuleTab } from "../types";

defineOptions({
  name: "BleModuleTabs"
});

defineProps<{
  activeModule: ModuleTab;
  activeModuleId: ModuleId;
  tabs: ModuleTab[];
}>();

const emit = defineEmits<{
  select: [moduleId: ModuleId];
  focusCommand: [inputId: "customCmd" | "appCmd"];
}>();
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
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeModuleId === tab.id"
        :class="{ 'is-active': activeModuleId === tab.id }"
        @click="emit('select', tab.id)"
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
