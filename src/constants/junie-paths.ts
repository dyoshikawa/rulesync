import { join } from "node:path";

export const JUNIE_DIR = ".junie";
export const JUNIE_COMMANDS_DIR_PATH = join(JUNIE_DIR, "commands");
export const JUNIE_SKILLS_DIR_PATH = join(JUNIE_DIR, "skills");
export const JUNIE_AGENTS_DIR_PATH = join(JUNIE_DIR, "agents");
// Junie also discovers subagents from the cross-tool `.agents/` directory
// (project `.agents/` and user `~/.agents/`) in addition to `.junie/agents/`.
// This is an import-only discovery root; generation still targets
// `.junie/agents/`.
// @see https://junie.jetbrains.com/docs/junie-cli-subagents.html
export const JUNIE_ALT_AGENTS_DIR_PATH = ".agents";
export const JUNIE_MCP_DIR_PATH = join(JUNIE_DIR, "mcp");
export const JUNIE_MCP_FILE_NAME = "mcp.json";
export const JUNIE_HOOKS_FILE_NAME = "config.json";
export const JUNIE_IGNORE_FILE_NAME = ".aiignore";
export const JUNIE_RULE_FILE_NAME = "AGENTS.md";
export const JUNIE_LEGACY_RULE_FILE_NAME = "guidelines.md";
