import { join } from "node:path";

export const ROO_DIR = ".roo";
export const ROO_COMMANDS_DIR_PATH = join(ROO_DIR, "commands");
export const ROO_SKILLS_DIR_PATH = join(ROO_DIR, "skills");
export const ROO_MCP_FILE_NAME = "mcp.json";
export const ROO_IGNORE_FILE_NAME = ".rooignore";

/**
 * Roo Code reads project-level custom modes from a single aggregated
 * `.roomodes` file at the workspace root (YAML; JSON also accepted). rulesync
 * emits the project-scope `.roomodes` file.
 * @see https://roocodeinc.github.io/Roo-Code/features/custom-modes
 */
export const ROO_MODES_FILE_NAME = ".roomodes";
