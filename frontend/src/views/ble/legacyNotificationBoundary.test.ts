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

test("current protocol skips the reserved NUS subscription without blocking supported channels", () => {
  const defaults = sourceBlock(
    "async function startDefaultBleNotifications",
    "const scanDevicesButton"
  );

  assert.doesNotMatch(
    defaults,
    /tryStartDefaultBleNotifications\('NUS'/,
    "the current protocol reserves NUS/CH0 and must not probe its CCC"
  );
  assert.match(
    defaults,
    /nus:\s*\{\s*status:\s*'unsupported',[\s\S]*?NUS.*保留.*未启用/
  );
  assert.match(defaults, /ensureBleTransportNotifications\(\)/);
  assert.match(defaults, /tryStartDefaultBleNotifications\('APP'/);
  assert.match(defaults, /tryStartDefaultBleNotifications\('DFU'/);
});
