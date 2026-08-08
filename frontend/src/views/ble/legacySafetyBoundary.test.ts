import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const legacyScript = readFileSync(
  new URL("../../../public/legacy/ble-tool.js", import.meta.url),
  "utf8"
);
const legacyMarkup = readFileSync(
  new URL("../../legacy/ble-tool.html", import.meta.url),
  "utf8"
);
const workbench = readFileSync(
  new URL("./workbench.vue", import.meta.url),
  "utf8"
);
const positionPanel = readFileSync(
  new URL("./components/BlePositionPanel.vue", import.meta.url),
  "utf8"
);
const moduleTabs = readFileSync(
  new URL("./components/BleModuleTabs.vue", import.meta.url),
  "utf8"
);
const logPanel = readFileSync(
  new URL("./components/BleLogPanel.vue", import.meta.url),
  "utf8"
);
const eventSidebar = readFileSync(
  new URL("./components/BleEventSidebar.vue", import.meta.url),
  "utf8"
);
const stylesheet = readFileSync(
  new URL("../../legacy/ble-tool.css", import.meta.url),
  "utf8"
);

function sourceBlock(start: string, end: string): string {
  const from = legacyScript.indexOf(start);
  const to = legacyScript.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source marker: ${start}`);
  assert.ok(to > from, `missing source end marker: ${end}`);
  return legacyScript.slice(from, to);
}

test("channel capability and safety gates both run before every raw write", () => {
  const rawWrite = sourceBlock(
    "async sendCmd(svc, ch, data)",
    "async startCmdNotifications"
  );
  assert.ok(
    rawWrite.indexOf("assertBleChannelWriteAvailable") <
      rawWrite.indexOf("/write")
  );
  assert.ok(
    rawWrite.indexOf("assertLegacyDeviceActionAllowed") <
      rawWrite.indexOf("/write")
  );

  const availability = sourceBlock(
    "function applyBleCommandAvailability",
    "async function startDefaultBleNotifications"
  );
  assert.match(availability, /disabled = false/);
  assert.match(availability, /missingBleChannelReason/);
  assert.match(
    legacyScript,
    /当前设备不具备所需的订阅和\/或发送能力/
  );
  assert.match(availability, /ble-capability-notice/);
  assert.match(availability, /enforceUnifiedSafetyGate\(\)/);

  const appCommand = sourceBlock(
    "async function sendAppCommandViaBle",
    "function getWifiCommandOptions"
  );
  assert.match(
    appCommand,
    /^async function[\s\S]*assertLegacyDeviceActionAllowed/
  );
  assert.match(
    appCommand,
    /controls\.forEach\(el => el\.disabled = false\);\s*enforceUnifiedSafetyGate\(\)/
  );
  assert.match(workbench, /risk:\s*"write_confirm"/);
});

test("ordinary actions bypass identity-only warnings while destructive actions retain the gate", () => {
  const appCommand = sourceBlock(
    "function appCommandSafetyOverrides",
    "function assertLegacyDeviceActionAllowed"
  );
  assert.match(appCommand, /destructiveAppCommands\.has\(command\)/);
  assert.match(appCommand, /\?\s*'destructive_confirm'/);
  assert.match(appCommand, /:\s*'write_confirm'/);

  for (const handler of ["chooseFile", "sendCert", "sendFile"]) {
    const block = sourceBlock(
      `function ${handler}(input)`,
      handler === "chooseFile"
        ? "function sendCert"
        : handler === "sendCert"
          ? "function sendFile"
          : "async function file_transfer"
    );
    assert.match(block, /capability:\s*'dfu'/, handler);
    assert.match(block, /risk:\s*'destructive_confirm'/, handler);
  }

  assert.match(workbench, /destructiveAppCommands/);
  assert.match(workbench, /risk:\s*destructive \? "destructive_confirm"/);
  assert.doesNotMatch(workbench, /genericDevicePolicy[\s\S]{0,160}risk:\s*"risk_unknown"/);
});

test("P0-FEN-01/02: policy-blocked fence editor never mounts an opaque iframe", () => {
  assert.doesNotMatch(positionPanel, /<iframe[\s\S]*?fenceEditorFrame/);
  assert.doesNotMatch(legacyMarkup, /<iframe[^>]+id="fenceEditorFrame"/);

  const displayData = sourceBlock(
    "function displayReceivedData",
    "function postMessageToFenceEditor"
  );
  assert.doesNotMatch(displayData, /sendAppCommandViaBle|peripheral\.sendCmd/);

  const messageListener = sourceBlock(
    "window.addEventListener('message', event =>",
    "function crc8"
  );
  assert.doesNotMatch(
    messageListener,
    /receiveAmapFenceData\(|sendAppCommandViaBle|peripheral\.sendCmd/
  );
  assert.match(positionPanel, /围栏写入已硬冻结/);

  const editorClosed = sourceBlock(
    "function editorModalClosed",
    "function closeFenceEditor"
  );
  assert.match(editorClosed, /if \(iframe && iframe\.style\.display !== 'none'\)/);
});

test("P0-LOG-01/02/03: legacy render paths sanitize and bound before display", () => {
  const appendLog = sourceBlock("function appendLog", "function appendLogLine");
  assert.match(appendLog, /sanitizeLegacyLogText/);
  assert.match(appendLog, /boundLegacyLogText/);
  assert.match(legacyScript, /pre\.textContent = `\[BODY REDACTED,/);
  assert.doesNotMatch(legacyScript, /url:\s*request\?\.url/);
  assert.match(legacyScript, /url:\s*sanitizeLegacyLogText\(request\?\.url/);
  assert.match(logPanel, /prepareLogForOutput/);
  assert.match(logPanel, /navigator\.clipboard\.writeText/);
  assert.match(logPanel, /new Blob/);
});

test("eSIM relay 403/413/502 responses fail closed before any device write", () => {
  const fetchRelay = sourceBlock(
    "async function fetchEsimHttpsViaProxy",
    "async function relayEsimHttpsRequest"
  );
  assert.match(fetchRelay, /if \(!response\.ok\)/);
  assert.match(fetchRelay, /throw new Error/);

  const relay = sourceBlock(
    "async function relayEsimHttpsRequest",
    "function handleEsimEvent"
  );
  assert.ok(
    relay.indexOf("await fetchEsimHttpsViaProxy") <
      relay.indexOf("await sendEsimCommand")
  );
});

test("P0-RWD-01/A11Y-01/02: responsive, keyboard, focus and live-region contracts are present", () => {
  assert.match(stylesheet, /@media \(max-width: 1280px\)/);
  assert.match(stylesheet, /@media \(max-width: 720px\)/);
  assert.match(stylesheet, /@media \(forced-colors: active\)/);
  assert.match(stylesheet, /:focus-visible/);
  assert.match(moduleTabs, /:aria-controls="tab\.id"/);
  assert.match(moduleTabs, /:tabindex="activeModuleId === tab\.id \? 0 : -1"/);
  assert.match(moduleTabs, /@keydown="handleTabKeydown/);
  assert.match(logPanel, /role="log"/);
  assert.match(eventSidebar, /role="log"/);
  assert.match(workbench, /role="tabpanel"/);
});
