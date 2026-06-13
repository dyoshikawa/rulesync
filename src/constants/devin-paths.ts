import { join } from "node:path";

export const DEVIN_DIR = ".devin";
export const WINDSURF_DIR = ".windsurf";
export const CODEIUM_DIR = ".codeium";
export const WINDSURF_SUBDIR = "windsurf";
export const CODEIUM_WINDSURF_DIR = join(CODEIUM_DIR, WINDSURF_SUBDIR);
export const WINDSURF_MEMORIES_SUBDIR = join(WINDSURF_SUBDIR, "memories");
export const DEVIN_RULES_DIR_PATH = join(DEVIN_DIR, "rules");
export const DEVIN_WORKFLOWS_DIR_PATH = join(DEVIN_DIR, "workflows");
export const DEVIN_SKILLS_DIR_PATH = join(DEVIN_DIR, "skills");
export const CODEIUM_WINDSURF_GLOBAL_WORKFLOWS_DIR_PATH = join(
  CODEIUM_WINDSURF_DIR,
  "global_workflows",
);
export const CODEIUM_WINDSURF_MEMORIES_DIR_PATH = join(CODEIUM_WINDSURF_DIR, "memories");
export const CODEIUM_WINDSURF_SKILLS_DIR_PATH = join(CODEIUM_WINDSURF_DIR, "skills");
export const DEVIN_MCP_FILE_NAME = "mcp_config.json";
export const DEVIN_HOOKS_FILE_NAME = "hooks.json";
export const DEVIN_GLOBAL_RULES_FILE_NAME = "global_rules.md";
export const DEVIN_IGNORE_FILE_NAME = ".devinignore";
export const DEVIN_LEGACY_IGNORE_FILE_NAME = ".codeiumignore";
