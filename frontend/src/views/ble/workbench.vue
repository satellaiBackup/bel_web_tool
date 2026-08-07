<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import "@/legacy/ble-tool.css";
import BleCommandPanel from "./components/BleCommandPanel.vue";
import BleCommunicationPanel from "./components/BleCommunicationPanel.vue";
import BleConnectionPanel from "./components/BleConnectionPanel.vue";
import C1DockProvisioningPanel from "./components/C1DockProvisioningPanel.vue";
import BleEventSidebar from "./components/BleEventSidebar.vue";
import BleMaintenancePanel from "./components/BleMaintenancePanel.vue";
import BleModuleTabs from "./components/BleModuleTabs.vue";
import BlePositionPanel from "./components/BlePositionPanel.vue";
import BleSafetyHeader from "./components/BleSafetyHeader.vue";
import BleWifiPanel from "./components/BleWifiPanel.vue";
import {
  createBleConnectionState,
  reduceBleConnectionState,
  type BleConnectionEvent
} from "./connectionState";
import {
  appendSanitizedBoundedLog,
  createSafetySessionState,
  evaluateSafetyGate,
  reduceSafetySessionState,
  sanitizeLogText,
  type DeviceActionPolicy,
  type SafetyDecision
} from "./safetyState";
import type {
  LegacyBridge,
  LegacySafetyController,
  LegacyWindow,
  ModuleId,
  ModuleTab
} from "./types";

defineOptions({
  name: "BleWorkbench"
});

const moduleTabs = [
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
  },
  {
    id: "c1DockProvisioningSection",
    label: "C1 Dock 配网",
    title: "C1 Dock BLE Wi-Fi 配网",
    description: "扫描、DHCP/静态网络、取消、状态恢复与 AWS 就绪链"
  },
  {
    id: "maintenanceSection",
    label: "设备维护 · 高风险",
    title: "设备维护",
    description: "固件升级、证书写入、文件传输与出厂测试"
  }
] satisfies ModuleTab[];

const activeModuleId = ref<ModuleId>("commandConsoleSection");
const focusedLogId = ref<string | null>(null);
const bleConnectionState = ref(createBleConnectionState());
const safetyState = ref(createSafetySessionState());
const lastBlockedReason = ref("");
const bleConnectionEventName = "ble-workbench-state";

const genericDevicePolicy: DeviceActionPolicy = {
  action: "legacy.device_operation",
  risk: "write_confirm"
};
const globalGateDecision = computed(() =>
  evaluateSafetyGate(safetyState.value, genericDevicePolicy)
);

const activeModule = computed(
  () =>
    moduleTabs.find(item => item.id === activeModuleId.value) ?? moduleTabs[0]
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
    wifiCmdRspLog: "Wi-Fi 命令日志",
    c1DockProvisioningLog: "C1 Dock 配网协议日志"
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
  if (target) {
    target.textContent = "";
    delete target.dataset.droppedEntries;
  }
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
  if (!isSessionOrLocalAction(name)) {
    const decision = safetyController.decide(policyForLegacyAction(name, args));
    if (!decision.allowed) {
      safetyController.reportBlocked(decision);
      return;
    }
  }
  void ensureLegacyScriptReady()
    .then(() => {
      const fn = (window as unknown as LegacyWindow)[name];
      if (typeof fn !== "function") {
        console.warn(`Legacy BLE handler "${name}" is not ready.`);
        return;
      }

      try {
        void Promise.resolve(fn(...args)).catch(error => {
          console.error(
            `Legacy BLE handler "${name}" failed:`,
            sanitizeLogText(error instanceof Error ? error.message : error)
          );
        });
      } catch (error) {
        console.error(
          `Legacy BLE handler "${name}" failed:`,
          sanitizeLogText(error instanceof Error ? error.message : error)
        );
      }
    })
    .catch(error => {
      console.error(
        `Legacy BLE script is not ready for "${name}":`,
        sanitizeLogText(error instanceof Error ? error.message : error)
      );
    });
}

async function legacyCallAsync<T = unknown>(
  name: string,
  ...args: unknown[]
): Promise<T | null> {
  safetyController.assertAllowed(policyForLegacyAction(name, args));
  await ensureLegacyScriptReady();
  const fn = (window as unknown as LegacyWindow)[name];
  if (typeof fn !== "function") {
    throw new Error(`Legacy BLE handler "${name}" is not ready.`);
  }
  return (await Promise.resolve(fn(...args))) as T;
}

function isSessionOrLocalAction(name: string): boolean {
  return [
    "scanBleDevices",
    "connectSelectedDevice",
    "disconnectBleDevice",
    "reconnectLastBleDevice",
    "clearEventMessages",
    "openWifiLocationPicker",
    "clearWifiLocation"
  ].includes(name);
}

const destructiveAppCommands = new Set([
  "factory-reset",
  "sec.format",
  "settings.format",
  "sys.poweroff"
]);

function appCommandName(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const payload = JSON.parse(value) as { c?: unknown };
    return typeof payload.c === "string" ? payload.c : "";
  } catch {
    return "";
  }
}

function policyForLegacyAction(
  name: string,
  args: unknown[] = []
): DeviceActionPolicy {
  const command = name === "sendAppCommandViaBle" ? appCommandName(args[0]) : "";
  const fenceAction =
    /fence|Fence/.test(name) ||
    name === "openFenceEditor" ||
    ["fc", "f0", "f1"].includes(command);
  const dfuAction = ["chooseFile", "sendCert", "sendFile"].includes(name);
  const nusAction = name === "sendCmdAndWaitForOK";
  const appAction =
    name === "sendAppCommandViaBle" ||
    /^(?:handleNtn|handleWifi|handleEsim)/.test(name);
  const destructive = dfuAction || destructiveAppCommands.has(command);
  return {
    action: `legacy.${name}`,
    capability: fenceAction
      ? "fence_write"
      : dfuAction
        ? "dfu"
        : nusAction
          ? "nus"
          : appAction
            ? "app"
            : undefined,
    risk: destructive ? "destructive_confirm" : "write_confirm",
    policy: fenceAction ? "policy_blocked" : "allowed"
  };
}

function applyDomSafetyPolicy(): void {
  document.querySelectorAll<HTMLElement>(".cmd").forEach(control => {
    const fenceOwner = control.closest('[data-safety-policy="fence-write"]');
    const destructiveOwner = control.closest(
      '[data-safety-risk="destructive"]'
    );
    const policy: DeviceActionPolicy = fenceOwner
      ? {
          action: control.id ? `fence.${control.id}` : "fence.legacy_control",
          capability: "fence_write",
          risk: "risk_unknown",
          policy: "policy_blocked"
        }
      : {
          action: control.id ? `legacy.${control.id}` : "legacy.device_control",
          risk: destructiveOwner ? "destructive_confirm" : "write_confirm"
        };
    const decision = safetyController.decide(policy);
    if (decision.allowed) {
      if (control.dataset.safetyDisabledReason) {
        delete control.dataset.safetyDisabledReason;
        const capabilityReason = control.dataset.bleCapabilityDisabledReason;
        if (capabilityReason) {
          if (
            control instanceof HTMLButtonElement ||
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement ||
            control instanceof HTMLTextAreaElement
          ) {
            control.disabled = true;
          }
          control.dataset.bleDisabledReason = capabilityReason;
          control.title = capabilityReason;
        } else {
          if (
            control instanceof HTMLButtonElement ||
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement ||
            control instanceof HTMLTextAreaElement
          ) {
            control.disabled = false;
          }
          delete control.dataset.bleDisabledReason;
          control.removeAttribute("aria-disabled");
          control.removeAttribute("aria-describedby");
          if (control.dataset.bleOriginalTitle) {
            control.title = control.dataset.bleOriginalTitle;
          } else {
            control.removeAttribute("title");
          }
          delete control.dataset.bleOriginalTitle;
        }
      }
      return;
    }
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    ) {
      control.disabled = true;
    }
    if (!control.dataset.bleOriginalTitle) {
      control.dataset.bleOriginalTitle = control.getAttribute("title") || "";
    }
    control.setAttribute("aria-disabled", "true");
    control.setAttribute("aria-describedby", "ble-global-gate-reason");
    control.dataset.safetyDisabledReason = decision.reason;
    control.dataset.bleDisabledReason =
      control.dataset.bleCapabilityDisabledReason || decision.reason;
    control.title = control.dataset.bleDisabledReason;
  });
}

const safetyController: LegacySafetyController = {
  decide: policy => evaluateSafetyGate(safetyState.value, policy),
  assertAllowed: policy => {
    const decision = evaluateSafetyGate(safetyState.value, policy);
    if (decision.allowed) return;
    safetyController.reportBlocked(decision);
    const error = new Error(`[${decision.code}] ${decision.reason}`);
    error.name = "SafetyGateError";
    throw error;
  },
  applyDomPolicy: applyDomSafetyPolicy,
  sanitizeLogText,
  appendBoundedLog: (current, incoming) =>
    appendSanitizedBoundedLog(current, incoming),
  reportBlocked: decision => {
    lastBlockedReason.value = `${decision.action}: ${decision.reason}`;
  },
  getState: () => safetyState.value
};

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
  callAsync: legacyCallAsync,
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
  return (
    typeof (window as unknown as LegacyWindow).scanBleDevices === "function"
  );
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
  void ensureLegacyScriptReady()
    .then(applyDomSafetyPolicy)
    .catch(error => {
      console.error(
        "Unable to initialize legacy BLE tool script.",
        sanitizeLogText(error instanceof Error ? error.message : error)
      );
    });
}

function handleBleConnectionEvent(event: Event): void {
  const detail = (event as CustomEvent<BleConnectionEvent>).detail;
  if (!detail?.type) return;
  bleConnectionState.value = reduceBleConnectionState(
    bleConnectionState.value,
    detail
  );
  safetyState.value = reduceSafetySessionState(safetyState.value, detail);
}

watch(
  safetyState,
  () => {
    void nextTick(applyDomSafetyPolicy);
  },
  { deep: true }
);

onMounted(() => {
  (window as unknown as LegacyWindow).__bleWorkbenchSafety = safetyController;
  window.addEventListener(bleConnectionEventName, handleBleConnectionEvent);
  window.addEventListener("keydown", handleWorkbenchKeydown);
  void nextTick(applyDomSafetyPolicy);
  loadLegacyScript();
});

onUnmounted(() => {
  window.removeEventListener(bleConnectionEventName, handleBleConnectionEvent);
  window.removeEventListener("keydown", handleWorkbenchKeydown);
  const legacyWindow = window as unknown as LegacyWindow;
  if (legacyWindow.__bleWorkbenchSafety === safetyController) {
    delete legacyWindow.__bleWorkbenchSafety;
  }
});
</script>

<template>
  <main class="ble-workbench">
    <div
      v-if="focusedLogId"
      class="log-focus-backdrop"
      @click="closeFocusedLog"
    />
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
        <BleSafetyHeader
          :state="safetyState"
          :gate-decision="globalGateDecision"
          :last-blocked-reason="lastBlockedReason"
        />
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
          role="tabpanel"
          aria-labelledby="module-tab-maintenanceSection"
          tabindex="0"
        />
        <BleCommandPanel
          v-show="activeModuleId === 'commandConsoleSection'"
          :bridge="bridge"
          :focused-log-id="focusedLogId"
          role="tabpanel"
          aria-labelledby="module-tab-commandConsoleSection"
          tabindex="0"
        />
        <BleCommunicationPanel
          v-show="activeModuleId === 'communicationSection'"
          :bridge="bridge"
          :focused-log-id="focusedLogId"
          role="tabpanel"
          aria-labelledby="module-tab-communicationSection"
          tabindex="0"
        />
        <BlePositionPanel
          v-show="activeModuleId === 'positioningSection'"
          :bridge="bridge"
          role="tabpanel"
          aria-labelledby="module-tab-positioningSection"
          tabindex="0"
        />
        <BleWifiPanel
          v-show="activeModuleId === 'wifiCommandsSection'"
          :bridge="bridge"
          :focused-log-id="focusedLogId"
          role="tabpanel"
          aria-labelledby="module-tab-wifiCommandsSection"
          tabindex="0"
        />
        <C1DockProvisioningPanel
          v-show="activeModuleId === 'c1DockProvisioningSection'"
          :bridge="bridge"
          :focused-log-id="focusedLogId"
          role="tabpanel"
          aria-labelledby="module-tab-c1DockProvisioningSection"
          tabindex="0"
        />
      </main>

      <BleEventSidebar
        :bridge="bridge"
        :focused-log-id="focusedLogId"
        :event-stream-state="safetyState.stream.state"
      />
    </div>
  </main>
</template>
