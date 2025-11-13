import { join } from "node:path";

export const RULESYNC_CONFIG_RELATIVE_FILE_PATH = "rulesync.jsonc";
export const RULESYNC_RELATIVE_DIR_PATH = ".rulesync";
export const RULESYNC_RELATIVE_RULES_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "rules");
export const RULESYNC_RELATIVE_COMMANDS_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "commands");
export const RULESYNC_RELATIVE_SUBAGENTS_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "subagents");
export const RULESYNC_RELATIVE_MCP_FILE_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "mcp.json");
export const RULESYNC_RELATIVE_IGNORE_FILE_PATH = ".rulesyncignore";
