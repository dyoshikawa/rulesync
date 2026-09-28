import { join } from "node:path";

import { ANTIGRAVITY_DIR, ANTIGRAVITY_GLOBAL_CONFIG_SUBDIR } from "./antigravity-paths.js";

export {
  ANTIGRAVITY_CLI_GLOBAL_WORKFLOWS_DIR_PATH,
  ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH,
  ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME,
  // The CLI's global subdirectory is the same `.gemini/antigravity-cli` path the
  // permissions feature writes to; re-export it under the name the skill consumer
  // uses, keeping a single source of truth in `antigravity-paths.ts`.
  ANTIGRAVITY_CLI_PERMISSIONS_SUBDIR as ANTIGRAVITY_CLI_GLOBAL_SUBDIR,
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_GLOBAL_CONFIG_SUBDIR,
  ANTIGRAVITY_IGNORE_FILE_NAME,
  ANTIGRAVITY_SKILLS_DIR_PATH,
  ANTIGRAVITY_WORKFLOWS_DIR_PATH,
} from "./antigravity-paths.js";

export const ANTIGRAVITY_AGENTS_DIR = ANTIGRAVITY_DIR;

// Project-root rules file. The CLI reads the cross-tool `AGENTS.md` standard at
// the workspace root (Gemini-lineage discovery order is `AGENTS.md`,
// `CONTEXT.md`, `GEMINI.md`), so rulesync emits `AGENTS.md` to align with the
// standard and the `antigravity-ide` target.
export const ANTIGRAVITY_RULE_FILE_NAME = "AGENTS.md";

// Global (user-scope) rules file lives in `~/.gemini/` and stays `GEMINI.md`,
// matching the `antigravity-ide` global file and the shared Gemini home config.
export const ANTIGRAVITY_GLOBAL_RULE_FILE_NAME = "GEMINI.md";

// Global (user-scope) modular rules live in the shared `~/.gemini/config/rules/`
// tree, which the CLI loads as separate global rules. Each file needs `trigger`
// frontmatter, and each is subject to the 24,000-byte per-file limit on its own
// rather than sharing the limit of the single `GEMINI.md`.
// @see https://antigravity.google/docs/rules
export const ANTIGRAVITY_GLOBAL_RULES_SUBDIR = join(ANTIGRAVITY_GLOBAL_CONFIG_SUBDIR, "rules");
