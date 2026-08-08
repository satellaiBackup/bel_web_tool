<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { Refresh } from "@element-plus/icons-vue";
import { message } from "@/utils/message";
import SerialPanel from "./components/SerialPanel.vue";
import GeneratorPanel from "./components/GeneratorPanel.vue";
import ReplayPanel from "./components/ReplayPanel.vue";
import NmeaPreview from "./components/NmeaPreview.vue";
import {
  closeNmeaSerial,
  generateNmea,
  getNmeaPorts,
  getNmeaState,
  loadNmeaReplay,
  openNmeaSerial,
  sentenceTypes,
  startNmea,
  startNmeaReplay,
  stopNmea,
  type GeneratorSettings,
  type ReplaySettings,
  type SerialConfig,
  type ToolState
} from "@/api/nmea";

defineOptions({
  name: "NmeaWorkbench"
});

const ports = ref<string[]>([]);
const state = ref<ToolState | null>(null);
const previewLines = ref<string[]>([]);
const pollTimer = ref<number | null>(null);

const serialConfig = ref<SerialConfig>({
  portName: "",
  baudRate: 115200,
  dataBits: 8,
  stopBits: 0,
  parity: 0
});

const generatorSettings = ref<GeneratorSettings>({
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

const replaySettings = ref<ReplaySettings>({
  replaySpeed: 1,
  loopPlayback: false,
  updateTimestamp: true
});

const busy = reactive({
  state: false,
  ports: false,
  serial: false,
  generate: false,
  start: false,
  stop: false,
  replayLoad: false,
  replayStart: false
});

const serialStatus = computed(
  () =>
    state.value?.serial ?? {
      open: false,
      ...serialConfig.value
    }
);

const replayStatus = computed(
  () =>
    state.value?.replay ?? {
      loaded: false,
      recordCount: 0,
      currentIndex: 0
    }
);

const runtime = computed(
  () =>
    state.value?.runtime ?? {
      running: false,
      mode: ""
    }
);

const generatorRunning = computed(
  () => runtime.value.running && runtime.value.mode === "generate"
);
const replayRunning = computed(
  () => runtime.value.running && runtime.value.mode === "replay"
);

const statusTiles = computed(() => [
  {
    label: "串口",
    value: serialStatus.value.open ? serialStatus.value.portName : "未连接",
    tone: serialStatus.value.open ? "green" : "gray"
  },
  {
    label: "运行",
    value: runtime.value.running ? runtime.value.mode : "Idle",
    tone: runtime.value.running ? "amber" : "gray"
  },
  {
    label: "回放",
    value: `${replayStatus.value.recordCount} 帧`,
    tone: replayStatus.value.loaded ? "blue" : "gray"
  },
  {
    label: "预览",
    value: `${previewLines.value.length} 条`,
    tone: previewLines.value.length ? "teal" : "gray"
  }
]);

function applyState(nextState: ToolState) {
  state.value = nextState;
  serialConfig.value = { ...nextState.config.serial };
  generatorSettings.value = {
    ...nextState.config.generator,
    sentenceOrder: [...nextState.config.generator.sentenceOrder],
    sentenceEnabled: { ...nextState.config.generator.sentenceEnabled }
  };
  replaySettings.value = { ...nextState.config.replay };
  if (nextState.lastGenerated?.length) {
    previewLines.value = [...nextState.lastGenerated];
  }
}

function errorMessage(error: unknown) {
  const data = (error as { response?: { data?: { error?: string } } })?.response
    ?.data;
  return data?.error || (error as Error)?.message || "操作失败";
}

async function refreshState(showLoading = true) {
  if (showLoading) busy.state = true;
  try {
    applyState(await getNmeaState());
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.state = false;
  }
}

async function refreshPorts() {
  busy.ports = true;
  try {
    const result = await getNmeaPorts();
    ports.value = result.ports;
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.ports = false;
  }
}

async function handleOpenSerial(config: SerialConfig) {
  busy.serial = true;
  try {
    applyState(await openNmeaSerial(config));
    message("串口已打开", { type: "success" });
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.serial = false;
  }
}

async function handleCloseSerial() {
  busy.serial = true;
  try {
    applyState(await closeNmeaSerial());
    message("串口已关闭", { type: "success" });
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.serial = false;
  }
}

async function handleGenerate(settings: GeneratorSettings) {
  busy.generate = true;
  try {
    const result = await generateNmea(settings);
    previewLines.value = result.lines;
    applyState(result.state);
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.generate = false;
  }
}

async function handleStart(settings: GeneratorSettings) {
  busy.start = true;
  try {
    applyState(await startNmea(settings));
    message("NMEA 发送已开始", { type: "success" });
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.start = false;
  }
}

async function handleStop() {
  busy.stop = true;
  try {
    applyState(await stopNmea());
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.stop = false;
  }
}

async function handleLoadReplay(file: File) {
  busy.replayLoad = true;
  try {
    const content = await file.text();
    applyState(await loadNmeaReplay({ fileName: file.name, content }));
    message("回放数据已加载", { type: "success" });
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.replayLoad = false;
  }
}

async function handleStartReplay(settings: ReplaySettings) {
  busy.replayStart = true;
  try {
    applyState(await startNmeaReplay(settings));
    message("回放已开始", { type: "success" });
  } catch (error) {
    message(errorMessage(error), { type: "error" });
  } finally {
    busy.replayStart = false;
  }
}

function startPolling() {
  if (pollTimer.value != null) return;
  pollTimer.value = window.setInterval(() => {
    void refreshState(false);
  }, 1200);
}

function stopPolling() {
  if (pollTimer.value == null) return;
  window.clearInterval(pollTimer.value);
  pollTimer.value = null;
}

watch(
  () => runtime.value.running,
  running => {
    if (running) startPolling();
    else stopPolling();
  }
);

onMounted(() => {
  void refreshState();
  void refreshPorts();
});

onUnmounted(() => {
  stopPolling();
});
</script>

<template>
  <main class="nmea-workbench">
    <section class="tool-heading">
      <div>
        <p class="tool-kicker">NMEA Console</p>
        <h1>NMEA 生成与回放</h1>
      </div>
      <el-tooltip content="刷新状态">
        <el-button
          :icon="Refresh"
          :loading="busy.state"
          aria-label="刷新状态"
          @click="refreshState()"
        />
      </el-tooltip>
    </section>

    <section class="status-grid">
      <div
        v-for="item in statusTiles"
        :key="item.label"
        class="status-tile"
        :class="`tone-${item.tone}`"
      >
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </section>

    <section class="work-grid">
      <SerialPanel
        :config="serialConfig"
        :status="serialStatus"
        :ports="ports"
        :loading="busy.serial"
        :refreshing="busy.ports"
        @refresh-ports="refreshPorts"
        @open="handleOpenSerial"
        @close="handleCloseSerial"
      />

      <GeneratorPanel
        :settings="generatorSettings"
        :running="generatorRunning"
        :loading="busy.generate"
        :starting="busy.start"
        :stopping="busy.stop && generatorRunning"
        @generate="handleGenerate"
        @start="handleStart"
        @stop="handleStop"
      />

      <ReplayPanel
        :settings="replaySettings"
        :status="replayStatus"
        :running="replayRunning"
        :loading="busy.replayLoad"
        :starting="busy.replayStart"
        :stopping="busy.stop && replayRunning"
        @load-file="handleLoadReplay"
        @start="handleStartReplay"
        @stop="handleStop"
      />

      <NmeaPreview :lines="previewLines" />
    </section>
  </main>
</template>

<style scoped lang="scss">
.nmea-workbench {
  min-height: calc(100vh - 86px);
  padding: 20px;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-page);
}

.tool-heading {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  max-width: 1440px;
  margin: 0 auto 14px;

  h1 {
    margin: 2px 0 0;
    color: var(--el-text-color-primary);
    font-size: 26px;
    font-weight: 760;
    line-height: 1.2;
  }
}

.tool-kicker,
:deep(.panel-kicker) {
  display: block;
  font-size: 12px;
  font-weight: 760;
  color: var(--el-color-primary);
  text-transform: uppercase;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  max-width: 1440px;
  margin: 0 auto 14px;
}

.status-tile {
  min-height: 74px;
  padding: 14px;
  overflow: hidden;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: var(--el-box-shadow-light);

  span {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  strong {
    display: block;
    overflow: hidden;
    color: var(--el-text-color-primary);
    font-size: 18px;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.tone-green {
  border-top: 3px solid var(--el-color-success);
}

.tone-amber {
  border-top: 3px solid var(--el-color-warning);
}

.tone-blue {
  border-top: 3px solid var(--el-color-primary);
}

.tone-teal {
  border-top: 3px solid var(--el-color-primary-light-3);
}

.tone-gray {
  border-top: 3px solid var(--el-color-info);
}

.work-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.85fr) minmax(420px, 1.15fr);
  gap: 14px;
  max-width: 1440px;
  margin: 0 auto;
}

:deep(.nmea-panel) {
  padding: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: var(--el-box-shadow-light);
}

:deep(.panel-heading) {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 14px;

  h2 {
    margin: 2px 0 0;
    color: var(--el-text-color-primary);
    font-size: 18px;
    font-weight: 740;
    line-height: 1.25;
  }
}

:deep(.panel-actions) {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 14px;
}

:deep(.port-line) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  gap: 8px;
}

:deep(.serial-grid),
:deep(.coordinate-grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

:deep(.coordinate-grid) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

:deep(.serial-current),
:deep(.replay-file),
:deep(.record-strip) {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 38px;
  padding: 8px 10px;
  margin-top: 14px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

:deep(.replay-file),
:deep(.record-strip) {
  justify-content: space-between;
}

:deep(.sentence-grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;

  .el-checkbox {
    width: 100%;
    height: 36px;
    margin: 0;
  }
}

:deep(.switch-grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  .el-checkbox {
    width: 100%;
    margin: 0;
  }
}

:deep(.replay-upload) {
  .el-upload,
  .el-upload-dragger {
    width: 100%;
  }

  .el-upload-dragger {
    padding: 18px 10px;
    border-radius: 8px;
  }

  .upload-icon {
    margin-bottom: 6px;
    font-size: 26px;
    color: var(--el-color-primary);
  }
}

:deep(.preview-panel) {
  grid-column: 1 / -1;
}

:deep(.nmea-output) {
  min-height: 260px;
  max-height: 420px;
  padding: 14px;
  margin: 0;
  overflow: auto;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  font-size: 13px;
  line-height: 1.65;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

:deep(.el-input-number) {
  width: 100%;
}

@media (width <= 1100px) {
  .work-grid {
    grid-template-columns: 1fr;
  }

  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (width <= 720px) {
  .nmea-workbench {
    padding: 12px;
  }

  .tool-heading {
    align-items: flex-start;
  }

  .status-grid,
  :deep(.serial-grid),
  :deep(.coordinate-grid),
  :deep(.sentence-grid),
  :deep(.switch-grid) {
    grid-template-columns: 1fr;
  }
}
</style>
