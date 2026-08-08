import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const legacyScript = readFileSync(
  new URL("../../../public/legacy/ble-tool.js", import.meta.url),
  "utf8"
);

function sourceBlock(start: string, end: string): string {
  const from = legacyScript.indexOf(start);
  const to = legacyScript.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source marker: ${start}`);
  assert.ok(to > from, `missing source end marker: ${end}`);
  return legacyScript.slice(from, to);
}

test("small-packet channels become available before the optional transport probe", () => {
  const defaults = sourceBlock(
    "async function startDefaultBleNotifications",
    "const scanDevicesButton"
  );

  assert.match(defaults, /nus:\s*\{\s*status:\s*'pending'\s*\}/);
  assert.match(defaults, /ensureBleTransportNotifications\(\)/);
  assert.match(
    defaults,
    /tryStartDefaultBleNotifications\('NUS',\s*uuidSvcNus,\s*uuidCharNotify/
  );
  assert.match(defaults, /tryStartDefaultBleNotifications\('APP'/);
  assert.match(defaults, /tryStartDefaultBleNotifications\('DFU'/);
  const nusIndex = defaults.indexOf("tryStartDefaultBleNotifications('NUS'");
  const appIndex = defaults.indexOf("tryStartDefaultBleNotifications('APP'");
  const dfuIndex = defaults.indexOf("tryStartDefaultBleNotifications('DFU'");
  const transportIndex = defaults.indexOf("await ensureBleTransportNotifications()");
  assert.ok(nusIndex < appIndex && appIndex < dfuIndex && dfuIndex < transportIndex);
  assert.match(defaults, /publishBleSubscriptionProgress\(subscriptions\)/);
  assert.match(defaults, /publishBleSubscriptionProgress\(subscriptions, true\)/);
  assert.doesNotMatch(defaults, /NUS CCC skipped/);
});

test("unsupported optional subscriptions use a normal API response", () => {
  const subscribe = sourceBlock(
    "async startCmdNotifications",
    "async stopCmdNotifications"
  );

  assert.match(subscribe, /response && response\.unsupported/);
  assert.match(subscribe, /BLECapabilityUnavailableError/);
});

test("a stale GATT session aborts notification initialization", () => {
  const retry = sourceBlock(
    "function isBleGATTSessionUnavailable",
    "function applyBleCommandAvailability"
  );
  const defaults = sourceBlock(
    "async function startDefaultBleNotifications",
    "const scanDevicesButton"
  );

  assert.match(retry, /includes\('BLE GATT 会话失效'\)/);
  assert.match(retry, /if \(isBleGATTSessionUnavailable\(error\)\) throw error/);
  assert.match(defaults, /if \(isBleGATTSessionUnavailable\(error\)\) throw error/);
});
