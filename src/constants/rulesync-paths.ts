import { join } from "node:path";

export const RULESYNC_CONFIG_RELATIVE_FILE_PATH = "rulesync.jsonc";
export const RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH = "rulesync.local.jsonc";
export const RULESYNC_RELATIVE_DIR_PATH = ".rulesync";
export const RULESYNC_RULES_RELATIVE_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "rules");
export const RULESYNC_COMMANDS_RELATIVE_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "commands");
export const RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "subagents");
export const RULESYNC_MCP_RELATIVE_FILE_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "mcp.json");
export const RULESYNC_HOOKS_RELATIVE_FILE_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "hooks.json");
export const RULESYNC_AIIGNORE_FILE_NAME = ".aiignore";
export const RULESYNC_AIIGNORE_RELATIVE_FILE_PATH = join(RULESYNC_RELATIVE_DIR_PATH, ".aiignore");
export const RULESYNC_IGNORE_RELATIVE_FILE_PATH = ".rulesyncignore";
export const RULESYNC_OVERVIEW_FILE_NAME = "overview.md";
export const RULESYNC_SKILLS_RELATIVE_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "skills");
export const RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH = join(
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  ".curated",
);
export const RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH = "rulesync.lock";

// File names (without path)
export const RULESYNC_MCP_FILE_NAME = "mcp.json";
export const RULESYNC_HOOKS_FILE_NAME = "hooks.json";

// Size limits
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
