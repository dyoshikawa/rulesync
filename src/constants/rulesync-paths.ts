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
export const RULESYNC_REMOTE_RULES_RELATIVE_DIR_PATH = join(
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  ".remote",
);
export const RULESYNC_REMOTE_COMMANDS_RELATIVE_DIR_PATH = join(
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  ".remote",
);
export const RULESYNC_REMOTE_SUBAGENTS_RELATIVE_DIR_PATH = join(
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
  ".remote",
);
export const RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH = "rulesync.lock";

// Feature to local directory mapping (the .rulesync/<feature> directory)
export const FEATURE_LOCAL_DIR_PATHS: Record<string, string> = {
  skills: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  rules: RULESYNC_RULES_RELATIVE_DIR_PATH,
  commands: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  subagents: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
};

// Hidden subdirectory names used for remote items within each feature directory
export const FEATURE_REMOTE_SUBDIR_NAMES: Record<string, string> = {
  skills: ".curated",
  rules: ".remote",
  commands: ".remote",
  subagents: ".remote",
};

// Feature to remote directory mapping for install/sources
// Skills use ".curated" for backward compat; new features use ".remote"
export const FEATURE_REMOTE_DIR_PATHS: Record<string, string> = {
  skills: RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  rules: RULESYNC_REMOTE_RULES_RELATIVE_DIR_PATH,
  commands: RULESYNC_REMOTE_COMMANDS_RELATIVE_DIR_PATH,
  subagents: RULESYNC_REMOTE_SUBAGENTS_RELATIVE_DIR_PATH,
};

// Feature to source directory name mapping (the directory name within the remote repo)
export const FEATURE_SOURCE_DIR_NAMES: Record<string, string> = {
  skills: "skills",
  rules: "rules",
  commands: "commands",
  subagents: "subagents",
};

// File names (without path)
export const RULESYNC_MCP_FILE_NAME = "mcp.json";
export const RULESYNC_HOOKS_FILE_NAME = "hooks.json";

// JSON Schema URLs (published as GitHub release assets)
export const RULESYNC_CONFIG_SCHEMA_URL =
  "https://github.com/dyoshikawa/rulesync/releases/latest/download/config-schema.json";
export const RULESYNC_MCP_SCHEMA_URL =
  "https://github.com/dyoshikawa/rulesync/releases/latest/download/mcp-schema.json";

// Size limits
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Concurrency limits
export const FETCH_CONCURRENCY_LIMIT = 10;
