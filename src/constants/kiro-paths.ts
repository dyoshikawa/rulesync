import { join } from "node:path";

export const KIRO_DIR = ".kiro";
export const KIRO_STEERING_DIR_NAME = "steering";
/**
 * Root steering file name used in global scope. Kiro does not read `~/AGENTS.md`,
 * so the root rule is written to `~/.kiro/steering/product.md` instead of the
 * project-scope root `AGENTS.md`.
 */
export const KIRO_GLOBAL_ROOT_STEERING_FILE_NAME = "product.md";
export const KIRO_PROMPTS_DIR_PATH = join(KIRO_DIR, "prompts");
export const KIRO_SKILLS_DIR_PATH = join(KIRO_DIR, "skills");
export const KIRO_SETTINGS_DIR_PATH = join(KIRO_DIR, "settings");
export const KIRO_AGENTS_DIR_PATH = join(KIRO_DIR, "agents");
export const KIRO_HOOKS_FILE_NAME = "default.json";
export const KIRO_MCP_FILE_NAME = "mcp.json";
export const KIRO_IGNORE_FILE_NAME = ".kiroignore";
