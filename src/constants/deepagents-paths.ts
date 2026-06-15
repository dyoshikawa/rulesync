import { join } from "node:path";

export const DEEPAGENTS_DIR = ".deepagents";
export const DEEPAGENTS_GLOBAL_DIR = join(DEEPAGENTS_DIR, "deepagents");
export const DEEPAGENTS_SKILLS_DIR_PATH = join(DEEPAGENTS_DIR, "skills");
export const DEEPAGENTS_GLOBAL_SKILLS_DIR_PATH = join(DEEPAGENTS_GLOBAL_DIR, "skills");
export const DEEPAGENTS_AGENTS_DIR_PATH = join(DEEPAGENTS_DIR, "agents");
export const DEEPAGENTS_GLOBAL_AGENTS_DIR_PATH = join(DEEPAGENTS_GLOBAL_DIR, "agents");
export const DEEPAGENTS_RULE_FILE_NAME = "AGENTS.md";
export const DEEPAGENTS_MCP_FILE_NAME = ".mcp.json";
export const DEEPAGENTS_HOOKS_FILE_NAME = "hooks.json";
