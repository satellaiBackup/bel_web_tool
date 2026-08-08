import assert from "node:assert/strict";
import test from "node:test";
import {
  beginC1DockScan,
  buildWifiConfigureCommand,
  buildWifiScanCommand,
  C1DockValidationError,
  createC1DockProvisioningState,
  describeC1DockCommandResponse,
  parseJsonObjects,
  redactC1DockCommand,
  reduceC1DockProvisioningPayload
} from "./c1DockProvisioning.ts";

test("scan command keeps the T1-compatible no-parameter shape", () => {
  assert.deepEqual(buildWifiScanCommand(), { c: "wifi.scan" });
  assert.deepEqual(buildWifiScanCommand(" scan-01 "), {
    c: "wifi.scan",
    p: { request_id: "scan-01" }
  });
  assert.throws(
    () => buildWifiScanCommand("x".repeat(33)),
    C1DockValidationError
  );
});

test("DHCP configure uses reversible SSID and redacts the password in logs", () => {
  const command = buildWifiConfigureCommand({
    requestId: "cfg-01",
    ssidMode: "base64",
    ssidBase64: "SG9tZQ==",
    password: "example-pass",
    ipMode: "dhcp"
  });
  assert.deepEqual(command, {
    c: "wifi.configure",
    p: {
      request_id: "cfg-01",
      ssid_b64: "SG9tZQ==",
      password: "example-pass",
      ip_mode: "dhcp"
    }
  });
  const safeLog = redactC1DockCommand(command);
  assert.doesNotMatch(safeLog, /example-pass/);
  assert.match(safeLog, /\[REDACTED\]/);
});

test("password validation accepts open, passphrase, and raw PSK forms", () => {
  const base = {
    ssidMode: "text" as const,
    ssidText: "Home",
    ipMode: "dhcp" as const
  };
  assert.doesNotThrow(() =>
    buildWifiConfigureCommand({ ...base, password: "" })
  );
  assert.doesNotThrow(() =>
    buildWifiConfigureCommand({ ...base, password: "12345678" })
  );
  assert.doesNotThrow(() =>
    buildWifiConfigureCommand({ ...base, password: "a".repeat(64) })
  );
  assert.throws(
    () => buildWifiConfigureCommand({ ...base, password: "short" }),
    /密码/
  );
  assert.throws(
    () => buildWifiConfigureCommand({ ...base, password: "z".repeat(64) }),
    /raw PSK/
  );
});

test("static IPv4 validation enforces the subnet and host-address contract", () => {
  const valid = buildWifiConfigureCommand({
    ssidMode: "text",
    ssidText: "Lab AP",
    password: "12345678",
    ipMode: "static",
    ipv4: "192.168.8.20",
    prefix: 24,
    gateway: "192.168.8.1",
    dns1: "1.1.1.1",
    dns2: "8.8.8.8"
  });
  assert.equal(valid.p?.gateway, "192.168.8.1");
  assert.equal(valid.p?.prefix, 24);

  assert.throws(
    () =>
      buildWifiConfigureCommand({
        ssidMode: "text",
        ssidText: "Lab AP",
        password: "12345678",
        ipMode: "static",
        ipv4: "192.168.8.20",
        prefix: 24,
        gateway: "192.168.9.1",
        dns1: "1.1.1.1"
      }),
    /同子网/
  );
  assert.throws(
    () =>
      buildWifiConfigureCommand({
        ssidMode: "text",
        ssidText: "Lab AP",
        password: "12345678",
        ipMode: "static",
        ipv4: "192.168.8.255",
        prefix: 24,
        gateway: "192.168.8.1",
        dns1: "1.1.1.1"
      }),
    /广播地址/
  );
});

test("scan reducer resets on a new attempt, deduplicates BSSID, and closes on done", () => {
  let state = beginC1DockScan(createC1DockProvisioningState());
  state = reduceC1DockProvisioningPayload(state, {
    e: "wifi-scan",
    r: {
      e: 3,
      s: "Home",
      m: "00:11:22:aa:bb:cc",
      r: -42,
      a: 7,
      q: 1,
      ch: 6,
      h: false,
      sb: "SG9tZQ=="
    },
    ts: 1234
  });
  assert.equal(state.scanResults.length, 1);
  assert.equal(state.scanResults[0].ssidText, "Home");
  assert.equal(state.scanAttempt, 7);

  state = reduceC1DockProvisioningPayload(state, {
    e: "wifi-scan",
    r: {
      e: 3,
      s: "Home",
      m: "00:11:22:aa:bb:cc",
      r: -35,
      a: 7,
      q: 2,
      ch: 6,
      h: false,
      sb: "SG9tZQ=="
    },
    ts: 1300
  });
  assert.equal(state.scanResults.length, 1);
  assert.equal(state.scanResults[0].rssi, -35);

  state = reduceC1DockProvisioningPayload(state, {
    e: "wifi-scan",
    r: { a: 7, done: true, status: "ok", count: 1, code: 1 },
    ts: 1400
  });
  assert.equal(state.scanStatus, "ok");
  assert.equal(state.lastResult, 1);
  assert.equal(state.lastAttempt, 7);
});

test("status snapshot and provisioning events preserve Wi-Fi success across cloud retries", () => {
  let state = reduceC1DockProvisioningPayload(
    createC1DockProvisioningState(),
    {
      c: "wifi.provision.status",
      r: {
        present: true,
        phase: "WAIT_CLOUD",
        attempt: 8,
        last_attempt: 7,
        last_result: 1,
        last_error: "MQTT_TLS",
        scan_count: 4
      }
    }
  );
  assert.equal(state.present, true);
  assert.equal(state.phase, "WAIT_CLOUD");
  assert.equal(state.activeAttempt, 8);

  state = reduceC1DockProvisioningPayload(state, {
    e: "wifi-provision",
    r: { a: 8, phase: "WAIT_CLOUD", ip: "192.168.8.20", code: 15, error: "MQTT_TLS" },
    ts: 3456
  });
  assert.equal(state.phase, "WAIT_CLOUD");
  assert.equal(state.lastError, "MQTT_TLS");
  assert.equal(state.lastResult, 15);

  state = reduceC1DockProvisioningPayload(state, {
    e: "wifi-provision",
    r: { a: 8, done: true, status: "ok", code: 1, error: "NONE" },
    ts: 4567
  });
  assert.equal(state.phase, "OPERATIONAL");
  assert.equal(state.activeAttempt, 0);
  assert.equal(state.lastAttempt, 8);
});

test("multiple JSON envelopes are parsed and command rejection stays observable", () => {
  const payloads = parseJsonObjects(
    'noise {"e":"wifi-scan","r":{"a":1,"q":1}}{"c":"wifi.scan","e":-4,"m":"NOT_INSERTED"}'
  );
  assert.equal(payloads.length, 2);
  const result = describeC1DockCommandResponse(
    { c: "wifi.scan" },
    payloads[1]
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /NOT_INSERTED/);
});
