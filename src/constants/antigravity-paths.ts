import { join } from "node:path";

export const ANTIGRAVITY_LEGACY_DIR = ".agent";
export const ANTIGRAVITY_LEGACY_RULES_DIR_PATH = join(ANTIGRAVITY_LEGACY_DIR, "rules");
export const ANTIGRAVITY_LEGACY_COMMANDS_DIR_PATH = join(ANTIGRAVITY_LEGACY_DIR, "workflows");
export const ANTIGRAVITY_LEGACY_SKILLS_DIR_PATH = join(ANTIGRAVITY_LEGACY_DIR, "skills");

export const ANTIGRAVITY_DIR = ".agents";
export const ANTIGRAVITY_SKILLS_DIR_PATH = join(ANTIGRAVITY_DIR, "skills");
export const ANTIGRAVITY_MCP_FILE_NAME = "mcp_config.json";
export const ANTIGRAVITY_HOOKS_FILE_NAME = "hooks.json";

export const ANTIGRAVITY_IGNORE_FILE_NAME = ".geminiignore";

export const ANTIGRAVITY_GEMINI_DIR = ".gemini";

// Single source of truth for the Antigravity CLI global subdirectory under
// `.gemini`. `antigravity-cli-paths.ts` re-exports these instead of redefining
// them, so the CLI and the shared module never drift apart.
export const ANTIGRAVITY_CLI_PERMISSIONS_SUBDIR = "antigravity-cli";
export const ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH = join(
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_CLI_PERMISSIONS_SUBDIR,
);
export const ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME = "settings.json";

export const ANTIGRAVITY_GLOBAL_CONFIG_SUBDIR = "config";
export const ANTIGRAVITY_GLOBAL_CONFIG_DIR_PATH = join(
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_GLOBAL_CONFIG_SUBDIR,
);
export const ANTIGRAVITY_GLOBAL_SKILLS_LEGACY_PATH = join(
  ANTIGRAVITY_GEMINI_DIR,
  "antigravity",
  "skills",
);
