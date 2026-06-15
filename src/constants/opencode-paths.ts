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
