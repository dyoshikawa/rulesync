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
// Copilot CLI auto-loads project-scoped MCP servers from `.github/mcp.json`
// (workspace config). Global/personal MCP servers live in
// `~/.copilot/mcp-config.json` (COPILOTCLI_MCP_FILE_NAME under COPILOT_DIR).
// https://github.com/github/copilot-cli (changelog v1.0.61, 2026-06-09)
export const COPILOTCLI_PROJECT_MCP_FILE_NAME = "mcp.json";
export const COPILOTCLI_AGENTS_DIR_PATH = join(COPILOT_DIR, "agents");
export const COPILOTCLI_HOOKS_DIR_PATH = join(COPILOT_DIR, "hooks");
export const COPILOTCLI_HOOKS_FILE_NAME = "copilotcli-hooks.json";
// Copilot CLI reads project skills from `.github/skills/` (shared with the
// Copilot IDE target via COPILOT_SKILLS_DIR_PATH) and personal/global skills
// from `~/.copilot/skills/`.
export const COPILOTCLI_SKILLS_GLOBAL_DIR_PATH = join(COPILOT_DIR, "skills");
// GitHub Copilot auto-discovers personal/global skills from `~/.copilot/skills/`
// (shared with the Copilot CLI personal skills location), mirroring the project
// `.github/skills/` layout.
// https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
export const COPILOT_SKILLS_GLOBAL_DIR_PATH = join(COPILOT_DIR, "skills");
