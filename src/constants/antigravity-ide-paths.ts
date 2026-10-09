import { join } from "node:path";

export const ANTIGRAVITY_IDE_AGENTS_DIR = ".agents";
export const ANTIGRAVITY_IDE_COMMANDS_DIR_PATH = join(ANTIGRAVITY_IDE_AGENTS_DIR, "workflows");
export const ANTIGRAVITY_IDE_RULE_FILE_NAME = "AGENTS.md";

export const ANTIGRAVITY_IDE_GEMINI_DIR = ".gemini";
export const ANTIGRAVITY_IDE_GLOBAL_RULE_FILE_NAME = "GEMINI.md";
export const ANTIGRAVITY_IDE_GLOBAL_CONFIG_SUBDIR = "config";
// Global modular rules live in `~/.gemini/config/rules/`, shared with the
// Antigravity CLI. Each file needs `trigger` frontmatter.
// @see https://antigravity.google/docs/rules
export const ANTIGRAVITY_IDE_GLOBAL_RULES_SUBDIR = join(
  ANTIGRAVITY_IDE_GLOBAL_CONFIG_SUBDIR,
  "rules",
);
// Global (legacy) workflows of Antigravity 2.0 live in `~/.gemini/config/workflows/`.
// @see https://antigravity.google/docs/migration/workflows-to-skills
export const ANTIGRAVITY_IDE_GLOBAL_WORKFLOWS_DIR_PATH = join(
  ANTIGRAVITY_IDE_GEMINI_DIR,
  ANTIGRAVITY_IDE_GLOBAL_CONFIG_SUBDIR,
  "workflows",
);
// Pre-2.0 global workflows location, also where rulesync wrote IDE global
// commands before they were emitted as skills. Read on import only.
export const ANTIGRAVITY_IDE_PRE_V2_GLOBAL_WORKFLOWS_DIR_PATH = join(
  ANTIGRAVITY_IDE_GEMINI_DIR,
  "antigravity",
  "global_workflows",
);

export const ANTIGRAVITY_IDE_PERMISSIONS_DIR = ".antigravity";
export const ANTIGRAVITY_IDE_PERMISSIONS_FILE_NAME = "settings.json";
