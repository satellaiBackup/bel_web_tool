<script setup lang="ts">
import { reactive } from "vue";
import type { LegacyBridge } from "../types";

defineOptions({
  name: "BleMaintenancePanel"
});

defineProps<{
  bridge: LegacyBridge;
}>();

const factoryCommands = [
  { id: "AT+FLASHRWTEST?", label: "外部 Flash 测试" },
  { id: "AT+CHARGER?", label: "充电芯片状态" },
  { id: "AT+LS?", label: "查询文件目录" }
];

const fileNames = reactive<Record<string, string>>({
  fwfile: "",
  certfile: "",
  genericfile: ""
});

function pickFile(inputId: keyof typeof fileNames): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (input && !input.disabled) input.click();
}

function updateFileName(inputId: keyof typeof fileNames, event: Event): void {
  const input = event.target as HTMLInputElement;
  fileNames[inputId] = input.files?.[0]?.name ?? "";
}
</script>

<template>
  <section id="maintenanceSection" class="admin-section">
    <div class="section-heading">
      <p class="eyebrow">Maintenance</p>
      <h2>设备维护</h2>
      <span>固件升级、证书写入、文件上传和基础产测。</span>
    </div>

    <div class="admin-grid two-columns">
      <article class="admin-card file-maintenance-card">
        <div class="card-heading">
          <div>
            <h3>文件与升级</h3>
            <p>选择文件后执行对应传输任务，通用上传可额外填写目标路径。</p>
          </div>
        </div>

        <div
          class="file-action-list"
          data-ble-requires="dfu"
          data-safety-risk="destructive"
        >
          <section class="file-action-row">
            <div class="file-action-meta">
              <label for="fwfile">固件升级</label>
              <span>选择固件包并通过 BLE DFU 通道写入设备。</span>
            </div>
            <div class="file-action-control">
              <input
                id="fwfile"
                type="file"
                class="cmd file-native-input"
                disabled
                @change="updateFileName('fwfile', $event)"
              />
              <button
                type="button"
                class="cmd cmd-button secondary file-picker-button"
                disabled
                @click="pickFile('fwfile')"
              >
                选择文件
              </button>
              <div class="file-selected-name">
                {{ fileNames.fwfile || "未选择文件" }}
              </div>
              <button
                class="cmd cmd-button file-action-button"
                disabled
                @click="bridge.callWithElement('chooseFile', 'fwfile')"
              >
                开始升级
              </button>
            </div>
          </section>

          <section class="file-action-row">
            <div class="file-action-meta">
              <label for="certfile">写入证书</label>
              <span>选择证书文件，按脚本规则识别并写入证书槽位。</span>
            </div>
            <div class="file-action-control">
              <input
                id="certfile"
                type="file"
                class="cmd file-native-input"
                disabled
                @change="updateFileName('certfile', $event)"
              />
              <button
                type="button"
                class="cmd cmd-button secondary file-picker-button"
                disabled
                @click="pickFile('certfile')"
              >
                选择文件
              </button>
              <div class="file-selected-name">
                {{ fileNames.certfile || "未选择文件" }}
              </div>
              <button
                class="cmd cmd-button file-action-button"
                disabled
                @click="bridge.callWithElement('sendCert', 'certfile')"
              >
                写入证书
              </button>
            </div>
          </section>

          <section class="file-action-row file-action-row-wide">
            <div class="file-action-meta">
              <label for="genericfile">上传文件</label>
              <span>上传任意文件，可指定设备端目录或文件路径。</span>
            </div>
            <div class="file-action-control file-action-control-stacked">
              <input
                id="genericfile"
                type="file"
                class="cmd file-native-input"
                disabled
                @change="updateFileName('genericfile', $event)"
              />
              <button
                type="button"
                class="cmd cmd-button secondary file-picker-button"
                disabled
                @click="pickFile('genericfile')"
              >
                选择文件
              </button>
              <div class="file-selected-name">
                {{ fileNames.genericfile || "未选择文件" }}
              </div>
              <input
                id="genericfilePath"
                type="text"
                placeholder="可选路径，例如 /logs/"
                class="cmd cmd-input admin-input"
                disabled
              />
              <button
                class="cmd cmd-button file-action-button"
                disabled
                @click="bridge.callWithElement('sendFile', 'genericfile')"
              >
                上传文件
              </button>
            </div>
          </section>
        </div>
      </article>

      <article class="admin-card">
        <div class="card-heading">
          <div>
            <h3>出厂测试</h3>
            <p>常用产测 AT 命令和响应结果。</p>
          </div>
        </div>

        <div class="command-list compact" data-ble-requires="nus">
          <div
            v-for="command in factoryCommands"
            :key="command.id"
            class="command-row"
          >
            <button
              :id="command.id"
              class="cmd cmd-button"
              disabled
              @click="bridge.sendFactoryCommand(command.id)"
            >
              {{ command.label }}
            </button>
            <label :for="command.id" class="rsp response-text"></label>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped lang="scss">
.file-maintenance-card {
  align-content: start;
}

.file-action-list {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.file-action-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.36fr) minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--ble-border-soft);
  border-radius: 8px;
  background: var(--ble-surface-soft);
}

.file-action-meta {
  display: grid;
  gap: 4px;
  min-width: 0;

  label {
    color: var(--ble-text);
    font-size: 14px;
    font-weight: 900;
  }

  span {
    color: var(--ble-subtle);
    font-size: 12px;
    line-height: 1.45;
  }
}

.file-action-control {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) 112px;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.file-action-control-stacked {
  grid-template-columns: 96px minmax(130px, 0.8fr) minmax(130px, 0.7fr) 112px;
}

.file-native-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.file-picker-button {
  width: 96px;
  min-height: 36px;
  padding-inline: 12px;
  white-space: nowrap;
}

.file-selected-name {
  min-width: 0;
  overflow: hidden;
  color: var(--ble-subtle);
  font-size: 13px;
  line-height: 36px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-action-button {
  width: 112px;
  min-height: 36px;
  padding-inline: 12px;
  white-space: nowrap;
}

@media (width <= 1280px) {
  .file-action-row,
  .file-action-control,
  .file-action-control-stacked {
    grid-template-columns: 1fr;
  }

  .file-picker-button,
  .file-action-button {
    width: 100%;
  }

  .file-selected-name {
    line-height: 1.4;
  }
}
</style>
