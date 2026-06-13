<script setup lang="ts">
import { computed, ref } from "vue";
import { DocumentCopy } from "@element-plus/icons-vue";

defineOptions({
  name: "NmeaPreview"
});

const props = defineProps<{
  lines: string[];
}>();

const copied = ref(false);
const text = computed(() => props.lines.map(line => line.trimEnd()).join("\n"));

async function copyText() {
  if (!text.value) return;
  await navigator.clipboard.writeText(text.value);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1200);
}
</script>

<template>
  <section class="nmea-panel preview-panel">
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Output</span>
        <h2>NMEA 输出</h2>
      </div>
      <el-button :disabled="!text" @click="copyText">
        <el-icon><DocumentCopy /></el-icon>
        {{ copied ? "已复制" : "复制" }}
      </el-button>
    </div>

    <pre v-if="text" class="nmea-output">{{ text }}</pre>
    <el-empty v-else description="暂无数据" :image-size="90" />
  </section>
</template>
