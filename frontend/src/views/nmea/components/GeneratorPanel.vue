<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import {
  MagicStick,
  VideoPause,
  VideoPlay
} from "@element-plus/icons-vue";
import {
  sentenceLabels,
  sentenceTypes,
  type GeneratorSettings
} from "@/api/nmea";

defineOptions({
  name: "NmeaGeneratorPanel"
});

const props = defineProps<{
  settings: GeneratorSettings;
  running?: boolean;
  loading?: boolean;
  starting?: boolean;
  stopping?: boolean;
}>();

const emit = defineEmits<{
  (e: "generate", settings: GeneratorSettings): void;
  (e: "start", settings: GeneratorSettings): void;
  (e: "stop"): void;
}>();

const form = reactive<GeneratorSettings>({
  latitude: 39.9042,
  longitude: 116.4074,
  altitude: 50,
  speed: 0,
  course: 0,
  satellites: 22,
  sendIntervalMs: 1000,
  sentenceOrder: [...sentenceTypes],
  sentenceEnabled: Object.fromEntries(sentenceTypes.map(item => [item, true]))
});

const enabledSentences = computed<string[]>({
  get() {
    return sentenceTypes.filter(item => form.sentenceEnabled[item]);
  },
  set(values) {
    const enabled = new Set(values);
    sentenceTypes.forEach(item => {
      form.sentenceEnabled[item] = enabled.has(item);
    });
  }
});

watch(
  () => props.settings,
  value => {
    Object.assign(form, {
      ...value,
      sentenceOrder: [...value.sentenceOrder],
      sentenceEnabled: { ...value.sentenceEnabled }
    });
  },
  { immediate: true, deep: true }
);

function snapshot(): GeneratorSettings {
  return {
    ...form,
    sentenceOrder: [...sentenceTypes],
    sentenceEnabled: { ...form.sentenceEnabled }
  };
}
</script>

<template>
  <section class="nmea-panel generator-panel">
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Generator</span>
        <h2>实时生成</h2>
      </div>
      <el-tag :type="running ? 'success' : 'info'" effect="light">
        {{ running ? "发送中" : "待机" }}
      </el-tag>
    </div>

    <el-form label-position="top" class="generator-form">
      <div class="coordinate-grid">
        <el-form-item label="纬度">
          <el-input-number
            v-model="form.latitude"
            :precision="6"
            :step="0.000001"
            :min="-90"
            :max="90"
            controls-position="right"
          />
        </el-form-item>
        <el-form-item label="经度">
          <el-input-number
            v-model="form.longitude"
            :precision="6"
            :step="0.000001"
            :min="-180"
            :max="180"
            controls-position="right"
          />
        </el-form-item>
        <el-form-item label="海拔 m">
          <el-input-number
            v-model="form.altitude"
            :precision="1"
            :step="1"
            controls-position="right"
          />
        </el-form-item>
      </div>

      <div class="coordinate-grid">
        <el-form-item label="速度 kn">
          <el-input-number
            v-model="form.speed"
            :precision="3"
            :step="0.1"
            :min="0"
            controls-position="right"
          />
        </el-form-item>
        <el-form-item label="航向 °">
          <el-input-number
            v-model="form.course"
            :precision="1"
            :step="1"
            :min="0"
            :max="359.9"
            controls-position="right"
          />
        </el-form-item>
        <el-form-item label="卫星数">
          <el-input-number
            v-model="form.satellites"
            :min="0"
            :max="32"
            :step="1"
            controls-position="right"
          />
        </el-form-item>
      </div>

      <el-form-item label="发送间隔 ms">
        <div class="interval-control">
          <el-input-number
            v-model="form.sendIntervalMs"
            :min="100"
            :max="5000"
            :step="100"
            controls-position="right"
            class="interval-input"
          />
          <el-slider
            v-model="form.sendIntervalMs"
            :min="100"
            :max="5000"
            :step="100"
            class="interval-slider"
          />
        </div>
      </el-form-item>

      <el-form-item label="语句">
        <el-checkbox-group v-model="enabledSentences" class="sentence-grid">
          <el-checkbox
            v-for="item in sentenceTypes"
            :key="item"
            :label="item"
            border
          >
            {{ sentenceLabels[item] }}
          </el-checkbox>
        </el-checkbox-group>
      </el-form-item>
    </el-form>

    <div class="panel-actions">
      <el-button type="primary" :loading="loading" @click="emit('generate', snapshot())">
        <el-icon><MagicStick /></el-icon>
        生成预览
      </el-button>
      <el-button
        type="success"
        :disabled="running"
        :loading="starting"
        @click="emit('start', snapshot())"
      >
        <el-icon><VideoPlay /></el-icon>
        开始发送
      </el-button>
      <el-button
        type="warning"
        plain
        :disabled="!running"
        :loading="stopping"
        @click="emit('stop')"
      >
        <el-icon><VideoPause /></el-icon>
        停止
      </el-button>
    </div>
  </section>
</template>

<style scoped lang="scss">
.interval-control {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  width: 100%;
}

.interval-input,
.interval-slider {
  min-width: 0;
}

@media (width <= 720px) {
  .interval-control {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
