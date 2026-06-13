import { join } from "node:path";

export const KILO_DIR = ".kilo";
export const KILO_GLOBAL_DIR = join(".config", "kilo");
export const KILO_RULES_DIR_NAME = "rules";
export const KILO_RULES_DIR_PATH = join(KILO_DIR, KILO_RULES_DIR_NAME);
export const KILO_COMMANDS_DIR_PATH = join(KILO_DIR, "commands");
export const KILO_GLOBAL_COMMANDS_DIR_PATH = join(KILO_GLOBAL_DIR, "commands");
export const KILO_SKILLS_DIR_PATH = join(KILO_DIR, "skills");
export const KILO_AGENTS_DIR_PATH = join(KILO_DIR, "agents");
export const KILO_GLOBAL_AGENTS_DIR_PATH = join(KILO_GLOBAL_DIR, "agents");
export const KILO_PLUGINS_DIR_PATH = join(KILO_DIR, "plugins");
export const KILO_GLOBAL_PLUGINS_DIR_PATH = join(KILO_GLOBAL_DIR, "plugins");
export const KILO_RULE_FILE_NAME = "AGENTS.md";
export const KILO_IGNORE_FILE_NAME = ".kilocodeignore";
export const KILO_JSONC_FILE_NAME = "kilo.jsonc";
export const KILO_JSON_FILE_NAME = "kilo.json";
export const KILO_HOOKS_FILE_NAME = "rulesync-hooks.js";
