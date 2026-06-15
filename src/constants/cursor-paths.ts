import { join } from "node:path";

export const CURSOR_DIR = ".cursor";
export const CURSOR_RULES_DIR_PATH = join(CURSOR_DIR, "rules");
export const CURSOR_COMMANDS_DIR_PATH = join(CURSOR_DIR, "commands");
export const CURSOR_SKILLS_DIR_PATH = join(CURSOR_DIR, "skills");
export const CURSOR_AGENTS_DIR_PATH = join(CURSOR_DIR, "agents");
export const CURSOR_MCP_FILE_NAME = "mcp.json";
export const CURSOR_HOOKS_FILE_NAME = "hooks.json";
export const CURSOR_IGNORE_FILE_NAME = ".cursorignore";
export const CURSOR_PERMISSIONS_FILE_NAME = "cli.json";
export const CURSOR_PERMISSIONS_GLOBAL_FILE_NAME = "cli-config.json";
