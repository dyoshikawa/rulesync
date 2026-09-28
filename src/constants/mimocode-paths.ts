import { join } from "node:path";

import type { OpencodeLayout } from "./opencode-paths.js";

/**
 * MiMo Code (Xiaomi's OpenCode fork) reads `.mimocode/` in the project and
 * `~/.config/mimocode/` globally, with the main config in `mimocode.jsonc` /
 * `mimocode.json`. The documented project config location is
 * `.mimocode/mimocode.jsonc`.
 *
 * @see https://github.com/XiaomiMiMo/MiMo-Code#configuration
 */
export const MIMOCODE_DIR = ".mimocode";
export const MIMOCODE_GLOBAL_DIR = join(".config", "mimocode");

export const MIMOCODE_LAYOUT: OpencodeLayout = {
  toolTarget: "mimocode",
  dir: MIMOCODE_DIR,
  globalDir: MIMOCODE_GLOBAL_DIR,
  configDir: MIMOCODE_DIR,
  jsonFileName: "mimocode.json",
  jsoncFileName: "mimocode.jsonc",
};
