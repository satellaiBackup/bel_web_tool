import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const pickerPage = readFileSync(
  new URL("../../../public/wifi-location-picker.html", import.meta.url),
  "utf8"
);
const legacyScript = readFileSync(
  new URL("../../../public/legacy/ble-tool.js", import.meta.url),
  "utf8"
);
const wifiPanel = readFileSync(
  new URL("./components/BleWifiPanel.vue", import.meta.url),
  "utf8"
);
const retainedLegacyPage = readFileSync(
  new URL("../../legacy/ble-tool.html", import.meta.url),
  "utf8"
);
const pickerScript = pickerPage.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(pickerScript, "missing inline picker script");

function sourceBlock(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source marker: ${start}`);
  assert.ok(to > from, `missing source end marker: ${end}`);
  return source.slice(from, to);
}

test("hidden map iframes stay on about:blank until the user opens the picker", () => {
  assert.match(
    wifiPanel,
    /id="wifiLocationPickerFrame"[\s\S]*?src="about:blank"/
  );
  assert.match(
    retainedLegacyPage,
    /id="wifiLocationPickerFrame"[^>]*src="about:blank"/
  );

  const openPicker = sourceBlock(
    legacyScript,
    "function openWifiLocationPicker",
    "function closeWifiLocationPicker"
  );
  assert.ok(
    openPicker.indexOf("frame.style.display = 'block'") <
      openPicker.indexOf("frame.src = 'wifi-location-picker.html'")
  );
});

test("reopening the picker reuses its iframe and sends the latest coordinates", () => {
  const openPicker = sourceBlock(
    legacyScript,
    "function openWifiLocationPicker",
    "function closeWifiLocationPicker"
  );

  assert.match(openPicker, /dataset\.wifiPickerLoaded === 'true'/);
  assert.match(openPicker, /dataset\.wifiPickerLoading === 'true'/);
  assert.match(openPicker, /type: 'wifi-location-picker-open'/);
  assert.match(openPicker, /wifiLocationPickerRequest = \{ lat, lng \}/);
  assert.equal(
    (openPicker.match(/frame\.src = 'wifi-location-picker\.html'/g) || [])
      .length,
    1
  );
});

test("map initialization waits for an open message, SDK readiness, and a sized container", () => {
  assert.doesNotMatch(
    pickerPage,
    /<script[^>]+src="https:\/\/webapi\.amap\.com/
  );
  assert.match(pickerPage, /function loadAmapSdk\(\)/);
  assert.match(pickerPage, /function waitForMapContainer\(/);
  assert.match(pickerPage, /rect\.width > 0 && rect\.height > 0/);
  assert.match(pickerPage, /type === 'wifi-location-picker-open'/);
  assert.match(pickerPage, /if \(map\) return map/);
  assert.equal((pickerPage.match(/new amap\.Map\(/g) || []).length, 1);
  assert.match(pickerPage, /requestAnimationFrame\(resizeMap\)/);
});

test("SDK and extension failures are surfaced instead of becoming silent map errors", () => {
  assert.match(pickerPage, /role="alert" aria-live="assertive"/);
  assert.match(pickerPage, /高德地图 SDK 加载超时/);
  assert.match(pickerPage, /高德地图 SDK 网络加载失败/);
  assert.match(pickerPage, /JShelter\|wrappers_generated/);
  assert.match(pickerPage, /getStatus\|canvas/);
  assert.match(pickerPage, /wifi-location-picker-error/);
  assert.match(pickerPage, /event\.preventDefault\(\)/);
});

test("picker lifecycle creates one map and reuses it across repeated opens", async () => {
  const windowListeners = new Map<string, Array<(event: any) => void>>();
  const scriptListeners = new Map<string, () => void>();
  const parentMessages: Array<Record<string, unknown>> = [];
  const parentWindow = {
    postMessage(message: Record<string, unknown>) {
      parentMessages.push(message);
    }
  };
  let mapCreateCount = 0;
  let resizeCount = 0;
  let center: number[] | undefined;

  class FakeMap {
    constructor(_element: string, options: { center: number[] }) {
      mapCreateCount += 1;
      center = options.center;
    }

    on() {}
    add() {}
    setCenter(nextCenter: number[]) {
      center = nextCenter;
    }
    resize() {
      resizeCount += 1;
    }
  }

  class FakeMarker {
    setPosition() {}
  }

  const elements = {
    error: { textContent: "", style: { display: "none" } },
    map: {
      getBoundingClientRect: () => ({ width: 800, height: 600 })
    },
    coordinate: { textContent: "" },
    confirmBtn: {
      disabled: true,
      addEventListener() {}
    }
  };
  const context: Record<string, any> = {
    console,
    location: { origin: "http://127.0.0.1:51888", search: "" },
    parent: parentWindow,
    performance,
    requestAnimationFrame: (callback: () => void) => callback(),
    setTimeout,
    clearTimeout,
    URLSearchParams,
    document: {
      getElementById: (id: keyof typeof elements) => elements[id],
      createElement: () => ({
        dataset: {},
        addEventListener: (type: string, listener: () => void) => {
          scriptListeners.set(type, listener);
        }
      }),
      head: {
        appendChild: () => {
          context.AMap = { Map: FakeMap, Marker: FakeMarker };
          scriptListeners.get("load")?.();
        }
      }
    },
    addEventListener: (type: string, listener: (event: any) => void) => {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    postMessage() {}
  };
  context.window = context;

  runInNewContext(pickerScript, context);
  assert.equal(mapCreateCount, 0, "hidden iframe must not initialize a map");

  const sendOpen = (lat: string, lng: string) => {
    windowListeners.get("message")?.forEach(listener =>
      listener({
        source: parentWindow,
        origin: context.location.origin,
        data: { type: "wifi-location-picker-open", lat, lng }
      })
    );
  };
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  sendOpen("22.500000", "113.900000");
  await settle();
  assert.equal(mapCreateCount, 1);
  assert.deepEqual(Array.from(center || []), [113.9, 22.5]);
  assert.equal(resizeCount, 1);

  sendOpen("31.230400", "121.473700");
  await settle();
  assert.equal(mapCreateCount, 1, "reopen must reuse the existing AMap.Map");
  assert.deepEqual(Array.from(center || []), [121.4737, 31.2304]);
  assert.equal(resizeCount, 2);

  let prevented = false;
  windowListeners.get("error")?.forEach(listener =>
    listener({
      message: "Cannot read properties of undefined (reading 'getStatus')",
      filename: "https://webapi.amap.com/maps?v=2.0",
      preventDefault: () => {
        prevented = true;
      }
    })
  );
  assert.equal(prevented, true);
  assert.match(elements.error.textContent, /地图渲染失败/);
  assert.equal(parentMessages.at(-1)?.type, "wifi-location-picker-error");
});
