import { join } from "node:path";

export const OPENCODE_DIR = ".opencode";
export const OPENCODE_GLOBAL_DIR = join(".config", "opencode");
export const OPENCODE_COMMANDS_DIR_PATH = join(OPENCODE_DIR, "commands");
export const OPENCODE_GLOBAL_COMMANDS_DIR_PATH = join(OPENCODE_GLOBAL_DIR, "commands");
export const OPENCODE_SKILLS_DIR_PATH = join(OPENCODE_DIR, "skills");
export const OPENCODE_SKILL_DIR_PATH = join(OPENCODE_DIR, "skill");
export const OPENCODE_GLOBAL_SKILLS_DIR_PATH = join(OPENCODE_GLOBAL_DIR, "skills");
export const OPENCODE_GLOBAL_SKILL_DIR_PATH = join(OPENCODE_GLOBAL_DIR, "skill");
export const OPENCODE_AGENTS_DIR_PATH = join(OPENCODE_DIR, "agents");
export const OPENCODE_GLOBAL_AGENTS_DIR_PATH = join(OPENCODE_GLOBAL_DIR, "agents");
export const OPENCODE_PLUGINS_DIR_PATH = join(OPENCODE_DIR, "plugins");
export const OPENCODE_GLOBAL_PLUGINS_DIR_PATH = join(OPENCODE_GLOBAL_DIR, "plugins");
export const OPENCODE_JSONC_FILE_NAME = "opencode.jsonc";
export const OPENCODE_JSON_FILE_NAME = "opencode.json";
export const OPENCODE_RULE_FILE_NAME = "AGENTS.md";
export const OPENCODE_HOOKS_FILE_NAME = "rulesync-hooks.js";

/**
 * On-disk layout of an OpenCode-family tool. OpenCode forks that keep its
 * config format but rename its directories (MiMo Code) reuse the OpenCode
 * adapters by overriding this layout instead of copying them.
 */
export type OpencodeLayout = {
  /** The rulesync tool target (also the tool-scoped key in rulesync files). */
  toolTarget: "opencode" | "mimocode";
  /** Project config directory (`.opencode`). */
  dir: string;
  /** Global config directory, relative to the home directory. */
  globalDir: string;
  /** Project directory holding the shared JSON(C) config. */
  configDir: string;
  jsonFileName: string;
  jsoncFileName: string;
  /**
   * Whether the tool lowers OpenCode V2 config spellings (plural `agents` /
   * `commands`, a flat `skills` array) found in its V1 config, as OpenCode V1
   * does since v1.18.24. Import reads them only when this is set.
   */
  readsV2ConfigSpellings: boolean;
};

export const OPENCODE_LAYOUT: OpencodeLayout = {
  toolTarget: "opencode",
  dir: OPENCODE_DIR,
  globalDir: OPENCODE_GLOBAL_DIR,
  configDir: ".",
  jsonFileName: OPENCODE_JSON_FILE_NAME,
  jsoncFileName: OPENCODE_JSONC_FILE_NAME,
  readsV2ConfigSpellings: true,
};
