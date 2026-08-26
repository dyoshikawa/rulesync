import { join } from "node:path";

export const ROO_DIR = ".roo";
export const ROO_COMMANDS_DIR_PATH = join(ROO_DIR, "commands");
export const ROO_SKILLS_DIR_PATH = join(ROO_DIR, "skills");
export const ROO_MCP_FILE_NAME = "mcp.json";

/**
 * Mode slugs Roo/Zoo Code themselves accept for a `rules-{mode}` directory:
 * the loader builds the directory name by interpolating the active mode slug,
 * and custom-mode slugs are restricted to this alphabet. Validating against it
 * also keeps an authored value from escaping `.roo/` through path separators or
 * `..` segments.
 */
export const ROO_MODE_SLUG_PATTERN = /^[a-zA-Z0-9-]+$/;

/**
 * `.roo/rules-{mode}/` — the mode-specific rule directory Roo/Zoo Code load
 * INSTEAD of `.roo/rules/` while that mode is active. The relative path is the
 * same in global scope, where it resolves under `~/.roo/`.
 * @see https://github.com/Zoo-Code-Org/Zoo-Code/blob/main/src/core/prompts/sections/custom-instructions.ts
 */
export const rooModeRulesDirName = (mode: string): string => `rules-${mode}`;
export const ROO_IGNORE_FILE_NAME = ".rooignore";

/**
 * Roo Code reads project-level custom modes from a single aggregated
 * `.roomodes` file at the workspace root (YAML; JSON also accepted). rulesync
 * emits the project-scope `.roomodes` file.
 * @see https://roocodeinc.github.io/Roo-Code/features/custom-modes
 */
export const ROO_MODES_FILE_NAME = ".roomodes";

/**
 * Roo Code is a VS Code extension, so its committable command allow/deny lists
 * are workspace settings rather than files in the `.roo/` agent-asset tree that
 * the other Roo Code features write.
 *
 * The extension's `package.json` name is `roo-cline`, so its contributed
 * settings live under that namespace: `roo-cline.allowedCommands` (contributed
 * default `["git log", "git diff", "git show"]`) and `roo-cline.deniedCommands`
 * (contributed default `[]`). Both are contributed with no `scope`, which in VS
 * Code means `window` scope — settable in a workspace's `.vscode/settings.json`
 * — and `ClineProvider.mergeCommandLists()` unions the workspace values into
 * the lists the auto-approval decision reads.
 *
 * These keys are Roo-era and predate the fork: they are present in Roo Code's
 * final release, v3.54.0 (2026-05-15), so they are inside the `roo` target's
 * documented scope rather than something Zoo Code added afterwards. The
 * continuation project renamed the namespace to `zoo-code.*` in v3.74.0, which
 * is why `zoocode` gets its own keys in `zoocode-paths.ts` instead of sharing
 * these.
 *
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/package.json
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/core/webview/ClineProvider.ts
 */
export const ROO_VSCODE_SETTINGS_DIR = ".vscode";
export const ROO_VSCODE_SETTINGS_FILE_NAME = "settings.json";
export const ROO_ALLOWED_COMMANDS_KEY = "roo-cline.allowedCommands";
export const ROO_DENIED_COMMANDS_KEY = "roo-cline.deniedCommands";
