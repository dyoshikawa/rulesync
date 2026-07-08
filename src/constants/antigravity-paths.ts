import { join } from "node:path";

export const ANTIGRAVITY_DIR = ".agents";
export const ANTIGRAVITY_SKILLS_DIR_PATH = join(ANTIGRAVITY_DIR, "skills");
// Project-scope workflows (custom slash commands) live in `.agents/workflows/`,
// shared by both the IDE and the CLI Antigravity 2.0 harness.
export const ANTIGRAVITY_WORKFLOWS_DIR_PATH = join(ANTIGRAVITY_DIR, "workflows");
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

// Global (user-scope) workflows for the CLI live under the CLI's own
// `~/.gemini/antigravity-cli/` tree (mirroring the CLI's global skills tree),
// distinct from the IDE's `~/.gemini/antigravity/global_workflows/`.
export const ANTIGRAVITY_CLI_GLOBAL_WORKFLOWS_DIR_PATH = join(
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_CLI_PERMISSIONS_SUBDIR,
  "global_workflows",
);

export const ANTIGRAVITY_GLOBAL_CONFIG_SUBDIR = "config";
export const ANTIGRAVITY_GLOBAL_CONFIG_DIR_PATH = join(
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_GLOBAL_CONFIG_SUBDIR,
);
