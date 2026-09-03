/**
 * CodeBuddy Code configuration-layout conventions.
 *
 * CodeBuddy Code (`@tencent-ai/codebuddy-code`) is Tencent Cloud's terminal
 * coding agent. Its configuration surface mirrors Claude Code closely: a
 * root memory file plus a `.codebuddy/` tree.
 *
 * @see https://www.codebuddy.ai/docs/cli/memory
 * @see https://www.codebuddy.ai/docs/cli/codebuddy-dir
 */

/** Root directory for CodeBuddy Code configuration, relative to the scope root. */
export const CODEBUDDY_DIR = ".codebuddy";

// Rules (memory) files. The root memory file lives at the project root (or
// under `.codebuddy/` as an alternative root / in global scope).
export const CODEBUDDY_RULE_FILE_NAME = "CODEBUDDY.md";
export const CODEBUDDY_LOCAL_RULE_FILE_NAME = "CODEBUDDY.local.md";
/** Modular rules directory name under `.codebuddy/`. */
export const CODEBUDDY_RULES_DIR_NAME = "rules";
