import { posix } from "node:path";

const { join } = posix;

export const RULESYNC_CONFIG_RELATIVE_FILE_PATH = "rulesync.jsonc";
export const RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH = "rulesync.local.jsonc";
export const RULESYNC_RELATIVE_DIR_PATH = ".rulesync";
export const RULESYNC_RULES_RELATIVE_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "rules");
export const RULESYNC_CURATED_RULES_RELATIVE_DIR_PATH = join(
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  ".curated",
);
export const RULESYNC_COMMANDS_RELATIVE_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "commands");
export const RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "subagents");
export const RULESYNC_CHECKS_RELATIVE_DIR_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "checks");
export const RULESYNC_MCP_RELATIVE_FILE_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "mcp.jsonc");
export const RULESYNC_HOOKS_RELATIVE_FILE_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "hooks.jsonc");
export const RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH = join(
  RULESYNC_RELATIVE_DIR_PATH,
  "permissions.jsonc",
);
// Legacy JSON variants remain readable and writable for existing projects.
// When both variants exist, the recommended JSONC file takes precedence.
export const RULESYNC_MCP_LEGACY_RELATIVE_FILE_PATH = join(RULESYNC_RELATIVE_DIR_PATH, "mcp.json");
export const RULESYNC_HOOKS_LEGACY_RELATIVE_FILE_PATH = join(
  RULESYNC_RELATIVE_DIR_PATH,
  "hooks.json",
);
export const RULESYNC_PERMISSIONS_LEGACY_RELATIVE_FILE_PATH = join(
  RULESYNC_RELATIVE_DIR_PATH,
  "permissions.json",
);
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
export const RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH = "rulesync-npm.lock.json";

// Recommended file names (without path)
export const RULESYNC_MCP_FILE_NAME = "mcp.jsonc";
export const RULESYNC_HOOKS_FILE_NAME = "hooks.jsonc";
export const RULESYNC_PERMISSIONS_FILE_NAME = "permissions.jsonc";
export const RULESYNC_MCP_LEGACY_FILE_NAME = "mcp.json";
export const RULESYNC_HOOKS_LEGACY_FILE_NAME = "hooks.json";
export const RULESYNC_PERMISSIONS_LEGACY_FILE_NAME = "permissions.json";

// JSON Schema URLs (published as GitHub release assets)
export const RULESYNC_CONFIG_SCHEMA_URL =
  "https://github.com/dyoshikawa/rulesync/releases/latest/download/config-schema.json";
export const RULESYNC_MCP_SCHEMA_URL =
  "https://github.com/dyoshikawa/rulesync/releases/latest/download/mcp-schema.json";
export const RULESYNC_PERMISSIONS_SCHEMA_URL =
  "https://github.com/dyoshikawa/rulesync/releases/latest/download/permissions-schema.json";

// Size limits
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Concurrency limits
export const FETCH_CONCURRENCY_LIMIT = 10;
