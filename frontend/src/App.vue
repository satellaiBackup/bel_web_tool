<script setup lang="ts">
import { onMounted, ref } from 'vue';
import legacyMarkup from './legacy/ble-tool.html?raw';

const legacyRoot = ref<HTMLElement | null>(null);

function loadLegacyScript(): void {
  if (window.__bleWebToolLegacyLoaded) {
    return;
  }

  const script = document.createElement('script');
  script.id = 'ble-web-tool-legacy-script';
  script.src = './legacy/ble-tool.js';
  script.async = false;
  script.onload = () => {
    window.__bleWebToolLegacyLoaded = true;
  };
  script.onerror = () => {
    console.error('Unable to load legacy BLE tool script.');
  };
  document.body.appendChild(script);
}

onMounted(() => {
  if (!legacyRoot.value) return;
  legacyRoot.value.innerHTML = legacyMarkup;
  loadLegacyScript();
});
</script>

<template>
  <ElConfigProvider>
    <main ref="legacyRoot"></main>
  </ElConfigProvider>
</template>
