import { ANTIGRAVITY_DIR } from "./antigravity-paths.js";

export {
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
