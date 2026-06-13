<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import "@/legacy/ble-tool.css";

defineOptions({
  name: "BleWorkbench"
});

type LegacyHandler = (...args: unknown[]) => unknown;
type LegacyWindow = Window & Record<string, LegacyHandler | undefined>;
type ModuleId =
  | "maintenanceSection"
  | "commandConsoleSection"
  | "appAdvancedCommandsSection"
  | "wifiCommandsSection";

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
    id: "appAdvancedCommandsSection",
    label: "通信定位",
    title: "通信定位",
    description: "卫星短信、NTN 状态与围栏管理"
  },
  {
    id: "wifiCommandsSection",
    label: "Wi-Fi 信标",
    title: "Wi-Fi 信标工具",
    description: "策略、信标列表与扫描"
  }
] satisfies Array<{
  id: ModuleId;
  label: string;
  title: string;
  description: string;
}>;

const activeModuleId = ref<ModuleId>("maintenanceSection");
const focusedLogId = ref<string | null>(null);

const activeModule = computed(
  () => moduleTabs.find(item => item.id === activeModuleId.value) ?? moduleTabs[0]
);

const factoryCommands = [
  { id: "AT+FLASHRWTEST?", label: "外部 Flash 测试" },
  { id: "AT+CHARGER?", label: "充电芯片状态" },
  { id: "AT+LS?", label: "查询文件目录" }
];

const appQuickCommands = [
  { label: "查询版本号", command: '{"c":"v"}' },
  { label: "查询电量", command: '{"c":"b"}' },
  { label: "查围栏状态", command: '{"c":"f"}' },
  { label: "开启围栏", command: '{"c":"f1"}' },
  { label: "关闭围栏", command: '{"c":"f0"}', tone: "secondary" },
  { label: "查激活围栏", command: '{"c":"fe"}' },
  { label: "查围栏列表", command: '{"c":"fl"}' },
  { label: "查询时间", command: '{"c":"st"}' },
  { label: "片内查询目录", command: '{"c":"dir"}' },
  { label: "查询剩余空间", command: '{"c":"ss"}' },
  { label: "查询设备信息", command: '{"c":"di"}' },
  { label: "重启设备", command: '{"c":"sys.reboot"}', tone: "warning" },
  { label: "船运模式", command: '{"c":"sys.poweroff"}', tone: "warning" },
  { label: "Info Dump", command: '{"c":"?"}' },
  { label: "格式化 Flash", command: '{"c":"sec.format"}', tone: "danger" },
  { label: "重置 Setting", command: '{"c":"settings.format"}', tone: "danger" }
];

const ntnStatusMetrics = [
  { label: "PM Mode", id: "ntnModeValue" },
  { label: "NTN State", id: "ntnStateValue" },
  { label: "Ready", id: "ntnReadyValue" },
  { label: "Last Error", id: "ntnErrValue" }
];

const wifiResultPanels = [
  {
    title: "当前 Wi-Fi 状态",
    action: "查询状态",
    handler: "handleWifiStatus",
    targetId: "wifiStatusDisplay"
  },
  {
    title: "最近扫描结果",
    action: "触发扫描",
    handler: "handleWifiScan",
    targetId: "wifiScanResults"
  },
  {
    title: "已保存的信标",
    action: "查询列表",
    handler: "handleWifiQueryTags",
    targetId: "wifiTagList"
  }
];

const focusedLogTitle = computed(() => {
  const titleMap: Record<string, string> = {
    customCmdRsp: "命令响应",
    eventMessagesLog: "事件消息",
    appCmdRspLog: "APP 命令响应",
    ntnConversationLog: "NTN 短信对话",
    ntnCmdRspLog: "NTN 命令日志",
    ntnEventLog: "NTN 事件日志",
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
    selectModule("commandConsoleSection");
    requestAnimationFrame(() => focusInput("customCmd"));
  } else if (key === "l") {
    event.preventDefault();
    selectModule("commandConsoleSection");
    requestAnimationFrame(() => focusInput("appCmd"));
  }
}

function legacyCall(name: string, ...args: unknown[]): void {
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

// The legacy script owns BLE state, notifications, and command parsing.
function loadLegacyScript(): void {
  if (document.getElementById("ble-web-tool-legacy-script")) {
    return;
  }

  const script = document.createElement("script");
  script.id = "ble-web-tool-legacy-script";
  script.src = "./legacy/ble-tool.js";
  script.async = false;
  script.onerror = () => {
    script.remove();
    console.error("Unable to load legacy BLE tool script.");
  };
  document.body.appendChild(script);
}

onMounted(() => {
  loadLegacyScript();
  window.addEventListener("keydown", handleWorkbenchKeydown);
});

onUnmounted(() => {
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
        <section id="connectionSection" class="admin-hero">
          <div class="hero-copy">
            <div class="admin-brand compact-brand">
              <div class="admin-brand-mark">BLE</div>
              <div>
                <h1>BLE 调试工作台</h1>
                <p>SATELLAI · 固件 <b>v8.1.0+</b></p>
              </div>
            </div>
            <p class="eyebrow">Device Console</p>
            <h2>设备连接</h2>
            <p>扫描、选择并建立 BLE 会话。</p>
          </div>

          <div class="connection-panel">
            <div class="connection-status">
              <span class="status-dot"></span>
              <label id="status">待连接</label>
            </div>
            <div class="connection-controls">
              <label class="form-field">
                <span>名称前缀</span>
                <input
                  id="nameFilter"
                  type="text"
                  placeholder="设备名称前缀，例如 SATELLAI"
                  class="admin-input"
                />
              </label>
              <label class="form-field form-field-wide">
                <span>设备列表</span>
                <select id="deviceSelect" class="admin-input">
                  <option value="">请先扫描设备</option>
                </select>
              </label>
              <div class="action-stack">
                <button
                  id="scanDevices"
                  type="button"
                  class="cmd-button"
                  data-vue-action="true"
                  @click="legacyCall('scanBleDevices')"
                >
                  扫描设备
                </button>
                <button
                  id="scanAndConnect"
                  type="button"
                  class="cmd-button"
                  data-vue-action="true"
                  @click="legacyCall('connectSelectedDevice')"
                >
                  连接选中设备
                </button>
                <button
                  id="disconnect"
                  type="button"
                  class="cmd-button danger"
                  data-vue-action="true"
                  hidden
                  @click="legacyCall('disconnectBleDevice')"
                >
                  断开连接
                </button>
              </div>
            </div>
            <div id="deviceSummary" class="connection-summary">
              请先扫描设备，列表会显示名称、MAC 和 RSSI。
            </div>
          </div>
        </section>

        <div class="interaction-bar">
          <div class="interaction-current">
            <span class="eyebrow">Current Module</span>
            <strong>{{ activeModule.title }}</strong>
            <small>{{ activeModule.description }}</small>
          </div>
          <div class="module-tabs" role="tablist" aria-label="工作台模块">
            <button
              v-for="tab in moduleTabs"
              :key="tab.id"
              type="button"
              role="tab"
              :aria-selected="activeModuleId === tab.id"
              :class="{ 'is-active': activeModuleId === tab.id }"
              @click="selectModule(tab.id)"
            >
              {{ tab.label }}
            </button>
          </div>
          <div class="quick-actions">
            <button type="button" class="cmd-button secondary" @click="focusCommandInput('customCmd')">
              NUS 输入
            </button>
            <button type="button" class="cmd-button secondary" @click="focusCommandInput('appCmd')">
              APP 输入
            </button>
          </div>
        </div>

        <section
          v-show="activeModuleId === 'maintenanceSection'"
          id="maintenanceSection"
          class="admin-section"
        >
          <div class="section-heading">
            <p class="eyebrow">Maintenance</p>
            <h2>设备维护</h2>
            <span>固件升级、证书写入、文件上传和基础产测。</span>
          </div>

          <div class="admin-grid two-columns">
            <article class="admin-card">
              <div class="card-heading">
                <div>
                  <h3>文件与升级</h3>
                  <p>固件、证书、通用文件统一放在这里。</p>
                </div>
              </div>

              <div class="form-list">
                <div class="form-row">
                  <label for="fwfile">固件升级</label>
                  <input
                    id="fwfile"
                    type="file"
                    class="cmd admin-input file-input"
                    disabled
                  />
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="callLegacyWithElement('chooseFile', 'fwfile')"
                  >
                    开始升级
                  </button>
                </div>
                <div class="form-row">
                  <label for="certfile">写入证书</label>
                  <input
                    id="certfile"
                    type="file"
                    class="cmd admin-input file-input"
                    disabled
                  />
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="callLegacyWithElement('sendCert', 'certfile')"
                  >
                    写入证书
                  </button>
                </div>
                <div class="form-row stacked">
                  <label for="genericfile">上传文件</label>
                  <div class="inline-controls">
                    <input
                      id="genericfile"
                      type="file"
                      class="cmd admin-input file-input"
                      disabled
                    />
                    <input
                      id="genericfilePath"
                      type="text"
                      placeholder="可选路径，例如 /logs/"
                      class="cmd cmd-input admin-input"
                      disabled
                    />
                    <button
                      class="cmd cmd-button"
                      disabled
                      @click="callLegacyWithElement('sendFile', 'genericfile')"
                    >
                      上传文件
                    </button>
                  </div>
                </div>
              </div>
            </article>

            <article class="admin-card">
              <div class="card-heading">
                <div>
                  <h3>出厂测试</h3>
                  <p>常用产测 AT 命令和响应结果。</p>
                </div>
              </div>

              <div class="command-list compact">
                <div
                  v-for="command in factoryCommands"
                  :key="command.id"
                  class="command-row"
                >
                  <button
                    :id="command.id"
                    class="cmd cmd-button"
                    disabled
                    @click="sendFactoryCommand(command.id)"
                  >
                    {{ command.label }}
                  </button>
                  <label :for="command.id" class="rsp response-text"></label>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section
          v-show="activeModuleId === 'commandConsoleSection'"
          id="commandConsoleSection"
          class="admin-section"
        >
          <div class="section-heading">
            <p class="eyebrow">Command Center</p>
            <h2>命令控制台</h2>
            <span>NUS 自定义命令、APP 快捷命令和蜂窝 / NTN AT 辅助命令。</span>
          </div>

          <div class="admin-grid two-columns">
            <article class="admin-card">
              <div class="card-heading">
                <div>
                  <h3>自定义命令</h3>
                  <p>按回车发送，响应会写入下方日志。</p>
                </div>
              </div>

              <div class="form-list">
                <label class="form-field">
                  <span>NUS 命令</span>
                  <input
                    id="customCmd"
                    type="text"
                    placeholder="输入自定义命令并按回车"
                    class="cmd cmd-input admin-input"
                    disabled
                  />
                </label>
                <label class="switch-line">
                  <input id="clearOnSent" type="checkbox" checked class="cmd" disabled />
                  <span>自动添加 \r\n</span>
                </label>
                <label class="form-field">
                  <span>APP 命令</span>
                  <input
                    id="appCmd"
                    type="text"
                    placeholder="输入 APP 命令并按回车"
                    class="cmd cmd-input admin-input"
                    disabled
                  />
                </label>
                <div>
                  <div class="log-toolbar">
                    <div class="log-title">命令响应</div>
                    <div class="log-actions">
                      <button type="button" @click="clearPanel('customCmdRsp')">
                        清空
                      </button>
                      <button type="button" @click="focusLog('customCmdRsp')">
                        聚焦
                      </button>
                    </div>
                  </div>
                  <div
                    id="customCmdRsp"
                    class="log-panel small"
                    :class="{ 'is-focused': focusedLogId === 'customCmdRsp' }"
                  ></div>
                </div>
              </div>
            </article>

            <article class="admin-card">
              <div class="card-heading">
                <div>
                  <h3>蜂窝与 NTN AT 辅助</h3>
                  <p>脚本中已有的低层 AT 调试入口。</p>
                </div>
              </div>

              <div class="command-list">
                <div class="command-row">
                  <button
                    id="readSN"
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('readSN')"
                  >
                    读取 SN
                  </button>
                  <label for="readSN" class="rsp response-text"></label>
                </div>
                <div class="command-row">
                  <input
                    id="WWANTRY"
                    type="number"
                    class="cmd cmd-input admin-input narrow"
                    min="0"
                    placeholder="重试次数"
                    disabled
                  />
                  <button
                    id="writeWWANTryCnt"
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('writeWWANTryCnt')"
                  >
                    写入 WWANTRY
                  </button>
                  <button
                    id="readWWANTryCnt"
                    class="cmd cmd-button secondary"
                    disabled
                    @click="legacyCall('readWWANTryCnt')"
                  >
                    读取 WWANTRY
                  </button>
                  <label for="writeWWANTryCnt" class="rsp response-text"></label>
                  <label for="readWWANTryCnt" class="rsp response-text"></label>
                </div>
                <div class="command-row">
                  <button
                    id="readservingcell"
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('readservingcell')"
                  >
                    查询 Serving Cell
                  </button>
                  <label for="readservingcell" class="rsp response-text"></label>
                </div>
                <div class="command-row">
                  <button
                    id="readDEVstate"
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('readDEVstate')"
                  >
                    查询 DEV 状态
                  </button>
                  <label for="readDEVstate" class="rsp response-text"></label>
                </div>
                <div class="ntn-at-box">
                  <div class="radio-group">
                    <label>
                      <input
                        id="modeAscii"
                        type="radio"
                        name="ntnMode"
                        value="ascii"
                        class="cmd"
                        checked
                        disabled
                      />
                      ASCII
                    </label>
                    <label>
                      <input
                        id="modeHex"
                        type="radio"
                        name="ntnMode"
                        value="hex"
                        class="cmd"
                        disabled
                      />
                      HEX
                    </label>
                  </div>
                  <div class="inline-controls">
                    <input
                      id="NTNsend"
                      type="text"
                      class="cmd cmd-input admin-input"
                      placeholder="输入 ASCII 内容，例如 Hello"
                      disabled
                    />
                    <button
                      id="writeNTNsendData"
                      class="cmd cmd-button"
                      disabled
                      @click="legacyCall('writeNTNsendData')"
                    >
                      写入 NTN 数据
                    </button>
                    <button
                      id="readNTNsendData"
                      class="cmd cmd-button secondary"
                      disabled
                      @click="legacyCall('readNTNsendData')"
                    >
                      读取 NTN 数据
                    </button>
                  </div>
                  <label for="writeNTNsendData" class="rsp response-text"></label>
                  <label for="readNTNsendData" class="rsp response-text"></label>
                </div>
              </div>
            </article>
          </div>

          <article class="admin-card">
            <div class="card-heading">
              <div>
                <h3>APP 快捷命令</h3>
                <p>高频 APP JSON 命令集中入口。</p>
              </div>
            </div>
            <div class="button-grid command-chip-grid">
              <button
                v-for="item in appQuickCommands"
                :key="item.command"
                class="cmd cmd-button"
                :class="item.tone"
                disabled
                @click="sendAppCommand(item.command)"
              >
                {{ item.label }}
              </button>
            </div>
            <div class="log-toolbar">
              <div class="log-title">APP 命令响应</div>
              <div class="log-actions">
                <button type="button" @click="clearPanel('appCmdRspLog')">
                  清空
                </button>
                <button type="button" @click="focusLog('appCmdRspLog')">
                  聚焦
                </button>
              </div>
            </div>
            <div
              id="appCmdRspLog"
              class="log-panel medium"
              :class="{ 'is-focused': focusedLogId === 'appCmdRspLog' }"
            ></div>
          </article>
        </section>

        <section
          v-show="activeModuleId === 'appAdvancedCommandsSection'"
          id="appAdvancedCommandsSection"
          class="admin-section"
        >
          <div class="section-heading">
            <p class="eyebrow">Communication & Location</p>
            <h2>通信定位</h2>
            <span>卫星短信、NTN 状态、环境配置和围栏管理。</span>
          </div>

          <div class="admin-grid two-columns">
            <article id="ntnSmsSection" class="admin-card">
              <div class="card-heading split">
                <div>
                  <h3>卫星短信 / NTN</h3>
                  <p>模式切换、状态查询、环境配置和短信收发。</p>
                </div>
                <div id="ntnMessage" class="message-line"></div>
              </div>

              <div class="button-group">
                <button
                  class="cmd cmd-button"
                  disabled
                  @click="legacyCall('handleNtnEnterOnlyMode')"
                >
                  进入仅卫星模式
                </button>
                <button
                  class="cmd cmd-button secondary"
                  disabled
                  @click="legacyCall('handleNtnExitOnlyMode')"
                >
                  退出到默认模式
                </button>
                <button
                  class="cmd cmd-button"
                  disabled
                  @click="legacyCall('handleNtnStatus')"
                >
                  查询 NTN 状态
                </button>
              </div>

              <div class="sub-card">
                <div class="metric-header">
                  <div>
                    <strong>卫星调试环境模式</strong>
                    <span>生产环境 IP / 调试环境 IP</span>
                  </div>
                  <div id="ntnEnvValue" class="metric-value">-</div>
                </div>
                <div class="inline-controls">
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('handleNtnEnvQuery')"
                  >
                    查询环境
                  </button>
                  <select
                    id="ntnEnvSelect"
                    class="cmd cmd-input admin-input narrow"
                    disabled
                  >
                    <option value="0">生产环境 IP</option>
                    <option value="1">调试环境 IP</option>
                  </select>
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('handleNtnEnvSet')"
                  >
                    设置环境
                  </button>
                </div>
              </div>

              <div id="ntnStatusDisplay" class="metric-grid">
                <div
                  v-for="metric in ntnStatusMetrics"
                  :key="metric.id"
                  class="metric-card"
                >
                  <span>{{ metric.label }}</span>
                  <strong :id="metric.id">-</strong>
                </div>
              </div>

              <div class="sms-composer">
                <input
                  id="ntnSmsId"
                  type="number"
                  class="cmd cmd-input admin-input narrow"
                  min="0"
                  max="65535"
                  step="1"
                  value="123"
                  placeholder="消息 ID"
                  disabled
                />
                <div class="textarea-wrap">
                  <textarea
                    id="ntnSmsText"
                    class="cmd cmd-input cmd-textarea admin-input"
                    rows="3"
                    maxlength="140"
                    placeholder="卫星短信文本，UTF-8 最大 140 字节"
                    disabled
                  ></textarea>
                  <span><b id="ntnSmsByteCount">0</b>/140 bytes</span>
                </div>
                <button
                  class="cmd cmd-button"
                  disabled
                  @click="legacyCall('handleNtnSmsSend')"
                >
                  发送短信
                </button>
              </div>

              <div class="log-toolbar">
                <div class="log-title">NTN 短信对话</div>
                <div class="log-actions">
                  <button type="button" @click="clearPanel('ntnConversationLog')">
                    清空
                  </button>
                  <button type="button" @click="focusLog('ntnConversationLog')">
                    聚焦
                  </button>
                </div>
              </div>
              <div
                id="ntnConversationLog"
                class="log-panel chat"
                :class="{ 'is-focused': focusedLogId === 'ntnConversationLog' }"
              ></div>

              <div class="admin-grid two-columns slim-gap">
                <div>
                  <div class="log-toolbar">
                    <div class="log-title">NTN 命令日志</div>
                    <div class="log-actions">
                      <button type="button" @click="clearPanel('ntnCmdRspLog')">
                        清空
                      </button>
                      <button type="button" @click="focusLog('ntnCmdRspLog')">
                        聚焦
                      </button>
                    </div>
                  </div>
                  <div
                    id="ntnCmdRspLog"
                    class="log-panel small"
                    :class="{ 'is-focused': focusedLogId === 'ntnCmdRspLog' }"
                  ></div>
                </div>
                <div>
                  <div class="log-toolbar">
                    <div class="log-title">NTN 事件日志</div>
                    <div class="log-actions">
                      <button type="button" @click="clearPanel('ntnEventLog')">
                        清空
                      </button>
                      <button type="button" @click="focusLog('ntnEventLog')">
                        聚焦
                      </button>
                    </div>
                  </div>
                  <div
                    id="ntnEventLog"
                    class="log-panel small"
                    :class="{ 'is-focused': focusedLogId === 'ntnEventLog' }"
                  ></div>
                </div>
              </div>
            </article>

            <article class="admin-card">
              <div class="card-heading">
                <div>
                  <h3>围栏管理</h3>
                  <p>围栏激活、禁用、添加、删除和调试事件。</p>
                </div>
              </div>

              <div class="sub-card">
                <h4>激活 / 禁用围栏</h4>
                <div class="inline-controls">
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('handleAppActivateFence')"
                  >
                    激活围栏
                  </button>
                  <input
                    id="app_fe1_param_fid"
                    type="text"
                    placeholder="围栏 ID，例如 f-1234"
                    class="cmd cmd-input admin-input"
                    disabled
                  />
                </div>
                <div class="inline-controls">
                  <button
                    class="cmd cmd-button secondary"
                    disabled
                    @click="legacyCall('handleAppDeactivateFence')"
                  >
                    禁用围栏
                  </button>
                  <input
                    id="app_fe0_param_fid"
                    type="text"
                    placeholder="围栏 ID，例如 f-1234"
                    class="cmd cmd-input admin-input"
                    disabled
                  />
                </div>
              </div>

              <div class="sub-card">
                <h4>围栏编辑器</h4>
                <iframe
                  id="fenceEditorFrame"
                  src="gps.html"
                  class="tool-overlay-frame fence-editor-frame"
                ></iframe>
                <button
                  id="openEditorBtn"
                  class="cmd cmd-button"
                  disabled
                  @click="legacyCall('openFenceEditor')"
                >
                  打开围栏编辑器
                </button>
                <div id="dataList" class="data-preview">
                  <p>尚未接收到数据。请打开编辑器并提交一个围栏。</p>
                </div>
              </div>

              <div class="sub-card">
                <h4>删除围栏</h4>
                <div class="inline-controls">
                  <button
                    class="cmd cmd-button danger"
                    disabled
                    @click="legacyCall('handleAppDeleteFence')"
                  >
                    删除围栏
                  </button>
                  <input
                    id="app_fd_param_fids"
                    type="text"
                    placeholder="围栏 ID 列表，逗号分隔，例如 f-1,f-2"
                    class="cmd cmd-input admin-input"
                    disabled
                  />
                </div>
              </div>

              <div class="sub-card">
                <h4>围栏参数</h4>
                <div class="inline-controls">
                  <input
                    id="app_sfp1_padding"
                    type="number"
                    step="any"
                    placeholder="Padding"
                    class="cmd cmd-input admin-input narrow"
                    disabled
                  />
                  <input
                    id="app_sfp1_margin"
                    type="number"
                    step="any"
                    placeholder="Margin"
                    class="cmd cmd-input admin-input narrow"
                    disabled
                  />
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('handleAppSetFenceParams')"
                  >
                    设置参数
                  </button>
                </div>
              </div>

              <div class="sub-card">
                <h4>围栏事件调试</h4>
                <div class="inline-controls">
                  <input
                    id="app_debug_event_type"
                    type="number"
                    min="1"
                    max="6"
                    placeholder="Type 1-6"
                    class="cmd cmd-input admin-input narrow"
                    disabled
                  />
                  <input
                    id="app_debug_event_lat"
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    class="cmd cmd-input admin-input"
                    disabled
                  />
                  <input
                    id="app_debug_event_lng"
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    class="cmd cmd-input admin-input"
                    disabled
                  />
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('handleAppDebugEventGnss')"
                  >
                    发送调试事件
                  </button>
                </div>
                <p class="hint">
                  Type: 1 lost, 2 fix, 3 secured, 4 approaching, 5 breach, 6
                  escaped
                </p>
              </div>
            </article>
          </div>
        </section>

        <section
          v-show="activeModuleId === 'wifiCommandsSection'"
          id="wifiCommandsSection"
          class="admin-section"
        >
          <div class="section-heading">
            <p class="eyebrow">Wi-Fi Beacon</p>
            <h2>Wi-Fi 信标工具</h2>
            <span>配置扫描策略，维护信标列表，并查看扫描结果。</span>
          </div>

          <article class="admin-card">
            <div class="card-heading split">
              <div>
                <h3>信标配置</h3>
                <p>扫描频率和丢失阈值会用于信标丢失判断。</p>
              </div>
              <div id="wifiMessage" class="message-line"></div>
            </div>

            <div class="admin-grid two-columns">
              <div class="sub-card">
                <h4>参数</h4>
                <div class="inline-controls">
                  <label class="mini-field" for="wifiScanFrequency">扫描频率</label>
                  <input
                    id="wifiScanFrequency"
                    type="number"
                    class="cmd cmd-input admin-input narrow"
                    placeholder="60"
                    min="30"
                    value="60"
                    disabled
                    title="最小30秒"
                  />
                  <span class="unit">秒</span>
                  <label class="mini-field" for="wifiLostCount">丢失阈值</label>
                  <input
                    id="wifiLostCount"
                    type="number"
                    class="cmd cmd-input admin-input narrow"
                    placeholder="1"
                    min="1"
                    value="1"
                    disabled
                    title="至少1次"
                  />
                  <span class="unit">次</span>
                </div>
                <p class="hint">
                  f 为扫描频率，l 为连续未检测到信标的次数阈值。
                </p>
              </div>

              <div class="sub-card">
                <h4>开关</h4>
                <div class="button-group">
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall('handleWifiEnable')"
                  >
                    开启信标
                  </button>
                  <button
                    class="cmd cmd-button secondary"
                    disabled
                    @click="legacyCall('handleWifiDisable')"
                  >
                    关闭信标
                  </button>
                </div>
              </div>
            </div>

            <div class="admin-grid two-columns">
              <div class="sub-card">
                <h4>添加 Wi-Fi 信标</h4>
                <div class="form-list">
                  <div class="inline-controls">
                    <input
                      id="wifiAddSsid"
                      type="text"
                      class="cmd cmd-input admin-input"
                      placeholder="SSID"
                      disabled
                    />
                    <input
                      id="wifiAddMac"
                      type="text"
                      class="cmd cmd-input admin-input"
                      placeholder="MAC 地址，例如 12:34:56:78:9A:BC"
                      disabled
                    />
                    <button
                      class="cmd cmd-button"
                      disabled
                      @click="legacyCall('handleWifiAddTag')"
                    >
                      添加
                    </button>
                  </div>
                  <div class="inline-controls">
                    <input
                      id="wifiAddLat"
                      type="number"
                      class="cmd cmd-input admin-input"
                      min="-90"
                      max="90"
                      step="0.000001"
                      placeholder="纬度 lat，可选"
                      disabled
                    />
                    <input
                      id="wifiAddLng"
                      type="number"
                      class="cmd cmd-input admin-input"
                      min="-180"
                      max="180"
                      step="0.000001"
                      placeholder="经度 lng，可选"
                      disabled
                    />
                    <button
                      class="cmd cmd-button secondary"
                      disabled
                      @click="legacyCall('openWifiLocationPicker')"
                    >
                      地图选点
                    </button>
                    <button
                      class="cmd cmd-button secondary"
                      disabled
                      @click="legacyCall('clearWifiLocation')"
                    >
                      清除位置
                    </button>
                  </div>
                  <div id="wifiLocationHint" class="hint">
                    经纬度为可选项；留空时只提交 SSID 和 MAC。
                  </div>
                  <iframe
                    id="wifiLocationPickerFrame"
                    src="wifi-location-picker.html"
                    class="tool-overlay-frame wifi-picker-frame"
                  ></iframe>
                </div>
              </div>

              <div class="sub-card">
                <h4>删除 Wi-Fi 信标</h4>
                <div class="inline-controls">
                  <input
                    id="wifiDeleteMac"
                    type="text"
                    class="cmd cmd-input admin-input"
                    placeholder="MAC 地址"
                    disabled
                  />
                  <button
                    class="cmd cmd-button danger"
                    disabled
                    @click="legacyCall('handleWifiDeleteTag')"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>

            <div class="admin-grid three-columns">
              <div
                v-for="panel in wifiResultPanels"
                :key="panel.targetId"
                class="sub-card"
              >
                <div class="card-heading compact-heading">
                  <h4>{{ panel.title }}</h4>
                  <button
                    class="cmd cmd-button"
                    disabled
                    @click="legacyCall(panel.handler)"
                  >
                    {{ panel.action }}
                  </button>
                </div>
                <div :id="panel.targetId" class="result-panel"></div>
              </div>
            </div>

            <div class="log-toolbar">
              <div class="log-title">Wi-Fi 命令日志</div>
              <div class="log-actions">
                <button type="button" @click="clearPanel('wifiCmdRspLog')">
                  清空
                </button>
                <button type="button" @click="focusLog('wifiCmdRspLog')">
                  聚焦
                </button>
              </div>
            </div>
            <div
              id="wifiCmdRspLog"
              class="log-panel medium"
              :class="{ 'is-focused': focusedLogId === 'wifiCmdRspLog' }"
            ></div>
          </article>
        </section>
      </main>

      <aside class="event-sidebar" aria-label="事件与日志侧栏">
        <section id="eventMessagesSection" class="event-card event-card-primary">
          <div class="event-sidebar-header">
            <div>
              <span class="eyebrow">Live Events</span>
              <h2>事件消息</h2>
              <p>设备上报的 <code>{"e":"xxxxx"}</code> 事件会持续写入这里。</p>
            </div>
            <span class="event-live-dot"></span>
          </div>

          <div class="event-toolbar">
            <button
              id="clearEventMessages"
              class="cmd-button secondary"
              type="button"
              @click="legacyCall('clearEventMessages')"
            >
              清空
            </button>
            <button
              class="cmd-button secondary"
              type="button"
              @click="focusLog('eventMessagesLog')"
            >
              聚焦
            </button>
          </div>

          <div
            id="eventMessagesLog"
            class="log-panel event-log"
            :class="{ 'is-focused': focusedLogId === 'eventMessagesLog' }"
          ></div>
        </section>

        <section class="event-card">
          <div class="side-section-heading">
            <h3>日志面板</h3>
            <p>把常用响应面板拉到前台查看。</p>
          </div>
          <div class="side-log-grid">
            <button type="button" @click="focusLog('customCmdRsp')">
              NUS 响应
            </button>
            <button type="button" @click="focusLog('appCmdRspLog')">
              APP 响应
            </button>
            <button type="button" @click="focusLog('ntnConversationLog')">
              NTN 对话
            </button>
            <button type="button" @click="focusLog('wifiCmdRspLog')">
              Wi-Fi 日志
            </button>
          </div>
        </section>
      </aside>
    </div>
  </main>
</template>
