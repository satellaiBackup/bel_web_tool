<script setup lang="ts">
import { reactive, watch } from "vue";
import type { ReplaySettings, ReplayStatus } from "@/api/nmea";
import type { UploadFile } from "element-plus";
import {
  FolderOpened,
  VideoPause,
  VideoPlay
} from "@element-plus/icons-vue";

defineOptions({
  name: "NmeaReplayPanel"
});

const props = defineProps<{
  settings: ReplaySettings;
  status: ReplayStatus;
  running?: boolean;
  loading?: boolean;
  starting?: boolean;
  stopping?: boolean;
}>();

const emit = defineEmits<{
  (e: "loadFile", file: File): void;
  (e: "start", settings: ReplaySettings): void;
  (e: "stop"): void;
}>();

const form = reactive<ReplaySettings>({
  replaySpeed: 1,
  loopPlayback: false,
  updateTimestamp: true
});

watch(
  () => props.settings,
  value => {
    Object.assign(form, value);
  },
  { immediate: true, deep: true }
);

function handleFileChange(file: UploadFile) {
  if (file.raw) {
    emit("loadFile", file.raw);
  }
}

function snapshot(): ReplaySettings {
  return { ...form };
}
</script>

<template>
  <section class="nmea-panel replay-panel">
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Replay</span>
        <h2>数据回放</h2>
      </div>
      <el-tag :type="status.loaded ? 'success' : 'info'" effect="light">
        {{ status.loaded ? `${status.recordCount} 帧` : "未加载" }}
      </el-tag>
    </div>

    <el-upload
      action="#"
      drag
      :limit="1"
      :auto-upload="false"
      :show-file-list="true"
      :on-change="handleFileChange"
      class="replay-upload"
    >
      <el-icon class="upload-icon"><FolderOpened /></el-icon>
      <div class="el-upload__text">选择 NMEA 文件</div>
    </el-upload>

    <div class="replay-file">
      <span>文件</span>
      <strong>{{ status.fileName || "-" }}</strong>
    </div>

    <el-form label-position="top" class="replay-form">
      <el-form-item label="速度">
        <el-slider
          v-model="form.replaySpeed"
          :min="0.25"
          :max="5"
          :step="0.25"
          show-input
        />
      </el-form-item>
      <div class="switch-grid">
        <el-checkbox v-model="form.loopPlayback" border>循环</el-checkbox>
        <el-checkbox v-model="form.updateTimestamp" border>更新时间</el-checkbox>
      </div>
    </el-form>

    <div class="panel-actions">
      <el-button
        type="success"
        :disabled="running || !status.loaded"
        :loading="starting"
        @click="emit('start', snapshot())"
      >
        <el-icon><VideoPlay /></el-icon>
        开始回放
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

    <div v-if="status.currentRecord" class="record-strip">
      <span>{{ status.currentIndex + 1 }} / {{ status.recordCount }}</span>
      <strong>
        {{ status.currentRecord.latitude.toFixed(6) }},
        {{ status.currentRecord.longitude.toFixed(6) }}
      </strong>
    </div>
  </section>
</template>
