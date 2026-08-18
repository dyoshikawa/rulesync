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
