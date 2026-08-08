import type { Plugin } from "vite";
import { copyFileSync, existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { __APP_INFO__ } from "./utils";

export function legacyToolCacheBust(): Plugin {
  let outDir = "";
  let rootDir = "";
  let command = "";

  return {
    name: "vite:legacy-tool-cache-bust",
    configResolved(config) {
      command = config.command;
      rootDir = config.root;
      outDir = isAbsolute(config.build.outDir)
        ? config.build.outDir
        : resolve(rootDir, config.build.outDir);
    },
    closeBundle() {
      if (command !== "build") return;

      const legacyDir = join(outDir, "legacy");
      const source = join(legacyDir, "ble-tool.js");
      if (!existsSync(source)) return;

      copyFileSync(source, join(legacyDir, __APP_INFO__.legacyScriptFile));
    }
  };
}
