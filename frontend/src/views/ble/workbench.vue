<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import "@/legacy/ble-tool.css";
import BleCommandPanel from "./components/BleCommandPanel.vue";
import BleCommunicationPanel from "./components/BleCommunicationPanel.vue";
import BleConnectionPanel from "./components/BleConnectionPanel.vue";
import BleEventSidebar from "./components/BleEventSidebar.vue";
import BleMaintenancePanel from "./components/BleMaintenancePanel.vue";
import BleModuleTabs from "./components/BleModuleTabs.vue";
import BlePositionPanel from "./components/BlePositionPanel.vue";
import BleWifiPanel from "./components/BleWifiPanel.vue";
import {
  createBleConnectionState,
  reduceBleConnectionState,
  type BleConnectionEvent
} from "./connectionState";
import type { LegacyBridge, LegacyWindow, ModuleId, ModuleTab } from "./types";

defineOptions({
  name: "BleWorkbench"
});

const moduleTabs = [
  {
    id: "maintenanceSection",
    label: "设备维护",
    title: "设备维护",
    description: "固件升级、证书写入、文件传输与出厂测试"
  },
  {
    id: "commandConsoleSection",
    label: "命令控制",
    title: "命令控制台",
    description: "NUS、APP、AT 辅助与高频 JSON 命令"
  },
  {
    id: "communicationSection",
    label: "通讯",
    title: "通讯",
    description: "eSIM 下发、卫星短报文、NTN 状态与调试环境"
  },
  {
    id: "positioningSection",
    label: "定位",
    title: "定位",
    description: "围栏管理、定位参数与 GNSS 调试事件"
  },
  {
    id: "wifiCommandsSection",
    label: "Wi-Fi 信标",
    title: "Wi-Fi 信标工具",
    description: "策略、信标列表与扫描结果"
  }
] satisfies ModuleTab[];

const activeModuleId = ref<ModuleId>("maintenanceSection");
const focusedLogId = ref<string | null>(null);
const bleConnectionState = ref(createBleConnectionState());
const bleConnectionEventName = "ble-workbench-state";

const activeModule = computed(
  () => moduleTabs.find(item => item.id === activeModuleId.value) ?? moduleTabs[0]
);

const focusedLogTitle = computed(() => {
  const titleMap: Record<string, string> = {
    customCmdRsp: "命令响应",
    eventMessagesLog: "事件消息",
    appCmdRspLog: "APP 命令响应",
    ntnConversationLog: "NTN 短报文对话",
    ntnCmdRspLog: "NTN 命令日志",
    ntnEventLog: "NTN 事件日志",
    esimCmdRspLog: "eSIM 命令日志",
    esimEventLog: "eSIM 事件日志",
    esimHttpLog: "eSIM HTTPS 日志",
    wifiCmdRspLog: "Wi-Fi 命令日志"
  };
  return focusedLogId.value ? titleMap[focusedLogId.value] : "";
});

function selectModule(moduleId: ModuleId): void {
  activeModuleId.value = moduleId;
}

function focusInput(id: string): void {
  const target = legacyElement<HTMLInputElement | HTMLTextAreaElement>(id);
  if (target && !target.disabled) target.focus();
}

function focusCommandInput(id: "customCmd" | "appCmd"): void {
  selectModule("commandConsoleSection");
  requestAnimationFrame(() => focusInput(id));
}

function clearPanel(id: string): void {
  const target = document.getElementById(id);
  if (target) target.textContent = "";
}

function focusLog(id: string): void {
  focusedLogId.value = id;
}

function closeFocusedLog(): void {
  focusedLogId.value = null;
}

function handleWorkbenchKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && focusedLogId.value) {
    closeFocusedLog();
    return;
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const index = Number(event.key) - 1;
    const module = moduleTabs[index];
    if (module) {
      event.preventDefault();
      selectModule(module.id);
    }
    return;
  }

  if (!(event.ctrlKey || event.metaKey)) return;

  const key = event.key.toLowerCase();
  if (key === "k") {
    event.preventDefault();
    focusCommandInput("customCmd");
  } else if (key === "l") {
    event.preventDefault();
    focusCommandInput("appCmd");
  }
}

function legacyCall(name: string, ...args: unknown[]): void {
  void ensureLegacyScriptReady()
    .then(() => {
      const fn = (window as unknown as LegacyWindow)[name];
      if (typeof fn !== "function") {
        console.warn(`Legacy BLE handler "${name}" is not ready.`);
        return;
      }

      try {
        void Promise.resolve(fn(...args)).catch(error => {
          console.error(`Legacy BLE handler "${name}" failed:`, error);
        });
      } catch (error) {
        console.error(`Legacy BLE handler "${name}" failed:`, error);
      }
    })
    .catch(error => {
      console.error(`Legacy BLE script is not ready for "${name}":`, error);
    });
}

function legacyElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function callLegacyWithElement(name: string, elementId: string): void {
  const target = legacyElement(elementId);
  if (!target) return;
  legacyCall(name, target);
}

function sendFactoryCommand(buttonId: string): void {
  callLegacyWithElement("sendCmdAndWaitForOK", buttonId);
}

function sendAppCommand(command: string): void {
  legacyCall("sendAppCommandViaBle", command);
}

const bridge: LegacyBridge = {
  call: legacyCall,
  callWithElement: callLegacyWithElement,
  clearPanel,
  focusLog,
  sendAppCommand,
  sendFactoryCommand
};

// The legacy script owns BLE state, notifications, and command parsing.
const legacyScriptVersion = `ble-tool-${__APP_INFO__.legacyScriptHash}`;
const legacyScriptSrc = import.meta.env.PROD
  ? `./legacy/${__APP_INFO__.legacyScriptFile}`
  : `./legacy/ble-tool.js?v=${legacyScriptVersion}`;
let legacyScriptReadyPromise: Promise<void> | null = null;

function hasLegacyBaseHandlers(): boolean {
  return typeof (window as unknown as LegacyWindow).scanBleDevices === "function";
}

function ensureLegacyScriptReady(): Promise<void> {
  if (hasLegacyBaseHandlers()) {
    return Promise.resolve();
  }
  if (legacyScriptReadyPromise) {
    return legacyScriptReadyPromise;
  }

  legacyScriptReadyPromise = new Promise<void>((resolve, reject) => {
    const complete = () => {
      window.setTimeout(() => {
        if (hasLegacyBaseHandlers()) {
          resolve();
        } else {
          reject(new Error("Legacy BLE script loaded without handlers."));
        }
      }, 0);
    };
    const fail = () => {
      reject(new Error("Unable to load legacy BLE tool script."));
    };

    const existingScript = document.getElementById(
      "ble-web-tool-legacy-script"
    ) as HTMLScriptElement | null;
    if (existingScript?.dataset.version === legacyScriptVersion) {
      existingScript.addEventListener("load", complete, { once: true });
      existingScript.addEventListener("error", fail, { once: true });
      window.setTimeout(complete, 5000);
      return;
    }
    existingScript?.remove();

    const script = document.createElement("script");
    script.id = "ble-web-tool-legacy-script";
    script.dataset.version = legacyScriptVersion;
    script.src = legacyScriptSrc;
    script.async = false;
    script.onload = complete;
    script.onerror = fail;
    document.body.appendChild(script);
  }).catch(error => {
    legacyScriptReadyPromise = null;
    throw error;
  });

  return legacyScriptReadyPromise;
}

function loadLegacyScript(): void {
  void ensureLegacyScriptReady().catch(error => {
    console.error("Unable to initialize legacy BLE tool script.", error);
  });
}

function handleBleConnectionEvent(event: Event): void {
  const detail = (event as CustomEvent<BleConnectionEvent>).detail;
  if (!detail?.type) return;
  bleConnectionState.value = reduceBleConnectionState(
    bleConnectionState.value,
    detail
  );
}

onMounted(() => {
  window.addEventListener(bleConnectionEventName, handleBleConnectionEvent);
  window.addEventListener("keydown", handleWorkbenchKeydown);
  loadLegacyScript();
});

onUnmounted(() => {
  window.removeEventListener(bleConnectionEventName, handleBleConnectionEvent);
  window.removeEventListener("keydown", handleWorkbenchKeydown);
});
</script>

<template>
  <main class="ble-workbench">
    <div
      v-if="focusedLogId"
      class="log-focus-backdrop"
      @click="closeFocusedLog"
    ></div>
    <div v-if="focusedLogId" class="log-focus-header">
      <strong>{{ focusedLogTitle }}</strong>
      <button
        class="cmd-button secondary"
        type="button"
        @click.stop="closeFocusedLog"
        @pointerdown.stop
      >
        关闭
      </button>
    </div>

    <div class="ble-tool-admin">
      <main class="admin-main">
        <BleConnectionPanel :bridge="bridge" :state="bleConnectionState" />
        <BleModuleTabs
          :active-module="activeModule"
          :active-module-id="activeModuleId"
          :tabs="moduleTabs"
          @select="selectModule"
          @focus-command="focusCommandInput"
        />

        <BleMaintenancePanel
          v-show="activeModuleId === 'maintenanceSection'"
          :bridge="bridge"
        />
        <BleCommandPanel
          v-show="activeModuleId === 'commandConsoleSection'"
          :bridge="bridge"
          :focused-log-id="focusedLogId"
        />
        <BleCommunicationPanel
          v-show="activeModuleId === 'communicationSection'"
          :bridge="bridge"
          :focused-log-id="focusedLogId"
        />
        <BlePositionPanel
          v-show="activeModuleId === 'positioningSection'"
          :bridge="bridge"
        />
        <BleWifiPanel
          v-show="activeModuleId === 'wifiCommandsSection'"
          :bridge="bridge"
          :focused-log-id="focusedLogId"
        />
      </main>

      <BleEventSidebar :bridge="bridge" :focused-log-id="focusedLogId" />
    </div>
  </main>
</template>
