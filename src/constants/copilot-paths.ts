import { join } from "node:path";

export const COPILOT_DIR = ".copilot";
export const GITHUB_DIR = ".github";
export const COPILOT_RULE_FILE_NAME = "copilot-instructions.md";
export const COPILOT_INSTRUCTIONS_DIR_PATH = join(COPILOT_DIR, "instructions");
export const COPILOT_PROMPTS_DIR_PATH = join(GITHUB_DIR, "prompts");
export const COPILOT_SKILLS_DIR_PATH = join(GITHUB_DIR, "skills");
export const COPILOT_AGENTS_DIR_PATH = join(GITHUB_DIR, "agents");
export const COPILOT_HOOKS_DIR_PATH = join(GITHUB_DIR, "hooks");
export const COPILOT_HOOKS_FILE_NAME = "copilot-hooks.json";
export const COPILOT_MCP_DIR = ".vscode";
export const COPILOT_MCP_FILE_NAME = "mcp.json";
export const COPILOTCLI_MCP_FILE_NAME = "mcp-config.json";
export const COPILOTCLI_AGENTS_DIR_PATH = join(COPILOT_DIR, "agents");
export const COPILOTCLI_HOOKS_DIR_PATH = join(COPILOT_DIR, "hooks");
export const COPILOTCLI_HOOKS_FILE_NAME = "copilotcli-hooks.json";
export const GITHUB_INSTRUCTIONS_DIR_PATH = join(GITHUB_DIR, "instructions");
