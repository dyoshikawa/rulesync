import { join } from "node:path";

export const ANTIGRAVITY_IDE_AGENTS_DIR = ".agents";
export const ANTIGRAVITY_IDE_COMMANDS_DIR_PATH = join(ANTIGRAVITY_IDE_AGENTS_DIR, "workflows");
export const ANTIGRAVITY_IDE_RULE_FILE_NAME = "AGENTS.md";

export const ANTIGRAVITY_IDE_GEMINI_DIR = ".gemini";
export const ANTIGRAVITY_IDE_GLOBAL_RULE_FILE_NAME = "GEMINI.md";
export const ANTIGRAVITY_IDE_GLOBAL_CONFIG_SUBDIR = "config";
export const ANTIGRAVITY_IDE_GLOBAL_WORKFLOWS_DIR_PATH = join(
  ANTIGRAVITY_IDE_GEMINI_DIR,
  "antigravity",
  "global_workflows",
);

export const ANTIGRAVITY_IDE_PERMISSIONS_DIR = ".antigravity";
export const ANTIGRAVITY_IDE_PERMISSIONS_FILE_NAME = "settings.json";
