<script setup lang="ts">
import { reactive, watch } from "vue";
import type { SerialConfig, SerialStatus } from "@/api/nmea";
import {
  CloseBold,
  Connection,
  Refresh,
  SwitchButton
} from "@element-plus/icons-vue";

defineOptions({
  name: "NmeaSerialPanel"
});

const props = defineProps<{
  config: SerialConfig;
  status: SerialStatus;
  ports: string[];
  loading?: boolean;
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  (e: "refreshPorts"): void;
  (e: "open", config: SerialConfig): void;
  (e: "close"): void;
}>();

const form = reactive<SerialConfig>({
  portName: "",
  baudRate: 115200,
  dataBits: 8,
  stopBits: 0,
  parity: 0
});

const baudRates = [4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const dataBits = [7, 8];
const stopBits = [
  { label: "1", value: 0 },
  { label: "1.5", value: 1 },
  { label: "2", value: 2 }
];
const parityOptions = [
  { label: "None", value: 0 },
  { label: "Odd", value: 1 },
  { label: "Even", value: 2 },
  { label: "Mark", value: 3 },
  { label: "Space", value: 4 }
];

watch(
  () => props.config,
  value => {
    Object.assign(form, value);
  },
  { immediate: true, deep: true }
);

function openSerial() {
  emit("open", { ...form });
}
</script>

<template>
  <section class="nmea-panel">
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Serial</span>
        <h2>串口连接</h2>
      </div>
      <el-tag :type="status.open ? 'success' : 'info'" effect="light">
        {{ status.open ? "已打开" : "未连接" }}
      </el-tag>
    </div>

    <el-form label-position="top" class="serial-form">
      <el-form-item label="端口">
        <div class="port-line">
          <el-select
            v-model="form.portName"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入端口"
          >
            <el-option
              v-for="port in ports"
              :key="port"
              :label="port"
              :value="port"
            />
          </el-select>
          <el-tooltip content="刷新端口">
            <el-button
              :icon="Refresh"
              :loading="refreshing"
              aria-label="刷新端口"
              @click="emit('refreshPorts')"
            />
          </el-tooltip>
        </div>
      </el-form-item>

      <div class="serial-grid">
        <el-form-item label="波特率">
          <el-select v-model="form.baudRate" filterable allow-create>
            <el-option
              v-for="baudRate in baudRates"
              :key="baudRate"
              :label="baudRate"
              :value="baudRate"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="数据位">
          <el-select v-model="form.dataBits">
            <el-option
              v-for="item in dataBits"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="停止位">
          <el-select v-model="form.stopBits">
            <el-option
              v-for="item in stopBits"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="校验位">
          <el-select v-model="form.parity">
            <el-option
              v-for="item in parityOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
      </div>
    </el-form>

    <div class="panel-actions">
      <el-button
        type="primary"
        :loading="loading"
        :disabled="status.open"
        @click="openSerial"
      >
        <el-icon><Connection /></el-icon>
        打开串口
      </el-button>
      <el-button
        type="danger"
        plain
        :disabled="!status.open"
        :loading="loading"
        @click="emit('close')"
      >
        <el-icon><CloseBold /></el-icon>
        关闭串口
      </el-button>
    </div>

    <div class="serial-current">
      <el-icon><SwitchButton /></el-icon>
      <span>{{ status.open ? `${status.portName} · ${status.baudRate}` : "Idle" }}</span>
    </div>
  </section>
</template>
