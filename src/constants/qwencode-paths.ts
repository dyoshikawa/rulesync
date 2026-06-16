import { join } from "node:path";

export const QWENCODE_DIR = ".qwen";
export const QWENCODE_MEMORIES_DIR_PATH = join(QWENCODE_DIR, "memories");
export const QWENCODE_COMMANDS_DIR_PATH = join(QWENCODE_DIR, "commands");
export const QWENCODE_AGENTS_DIR_PATH = join(QWENCODE_DIR, "agents");
export const QWENCODE_SKILLS_DIR_PATH = join(QWENCODE_DIR, "skills");
export const QWENCODE_RULE_FILE_NAME = "QWEN.md";
export const QWENCODE_IGNORE_FILE_NAME = ".qwenignore";
export const QWENCODE_SETTINGS_FILE_NAME = "settings.json";
