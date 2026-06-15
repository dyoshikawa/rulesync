import { join } from "node:path";

export const COPILOT_DIR = ".copilot";
export const GITHUB_DIR = ".github";
export const COPILOT_RULE_FILE_NAME = "copilot-instructions.md";
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
// Copilot CLI reads project skills from `.github/skills/` (shared with the
// Copilot IDE target via COPILOT_SKILLS_DIR_PATH) and personal/global skills
// from `~/.copilot/skills/`.
export const COPILOTCLI_SKILLS_GLOBAL_DIR_PATH = join(COPILOT_DIR, "skills");
