import { join } from "node:path";

export const COPILOT_DIR = ".copilot";
export const GITHUB_DIR = ".github";
export const COPILOT_RULE_FILE_NAME = "copilot-instructions.md";
export const COPILOT_PROMPTS_DIR_PATH = join(GITHUB_DIR, "prompts");
export const COPILOT_SKILLS_DIR_PATH = join(GITHUB_DIR, "skills");
export const COPILOT_AGENTS_DIR_PATH = join(GITHUB_DIR, "agents");
export const COPILOT_HOOKS_DIR_PATH = join(GITHUB_DIR, "hooks");
export const COPILOT_HOOKS_FILE_NAME = "copilot-hooks.json";
// User-scope hooks for VS Code Copilot (and the coding agent) live in
// `~/.copilot/hooks/`, which loads every `*.json` in the folder. The Copilot CLI
// global hooks file already occupies `copilot-hooks.json` there, so the
// VS Code target uses a distinct name and the two never overwrite each other.
// https://code.visualstudio.com/docs/agent-customization/hooks
// https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks
export const COPILOT_GLOBAL_HOOKS_FILE_NAME = "copilot-ide-hooks.json";
export const COPILOT_MCP_DIR = ".vscode";
export const COPILOT_MCP_FILE_NAME = "mcp.json";
// VS Code Copilot Chat reads its terminal auto-approval map
// (`chat.tools.terminal.autoApprove`) from the workspace settings file, which
// lives alongside `.vscode/mcp.json`.
// https://code.visualstudio.com/docs/agents/approvals
export const COPILOT_VSCODE_SETTINGS_FILE_NAME = "settings.json";
// Copilot CLI settings. The user-scope file is `~/.copilot/settings.json`
// (COPILOT_DIR); the repository-scope file is `.github/copilot/settings.json`,
// which shipped in CLI v1.0.60 and accepts a documented subset of the user-scope
// keys.
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
export const COPILOTCLI_SETTINGS_FILE_NAME = "settings.json";
export const COPILOTCLI_PROJECT_SETTINGS_DIR_PATH = join(GITHUB_DIR, "copilot");
export const COPILOTCLI_MCP_FILE_NAME = "mcp-config.json";
// Copilot CLI auto-loads project-scoped MCP servers from `.github/mcp.json`
// (workspace config). Global/personal MCP servers live in
// `~/.copilot/mcp-config.json` (COPILOTCLI_MCP_FILE_NAME under COPILOT_DIR).
// https://github.com/github/copilot-cli (changelog v1.0.61, 2026-06-09)
export const COPILOTCLI_PROJECT_MCP_FILE_NAME = "mcp.json";
export const COPILOTCLI_AGENTS_DIR_PATH = join(COPILOT_DIR, "agents");
// The single user-scope hooks folder. VS Code, the coding agent and the
// Copilot CLI all load every `*.json` in it, so both the `copilot` and
// `copilotcli` targets write here — under different filenames.
export const COPILOTCLI_HOOKS_DIR_PATH = join(COPILOT_DIR, "hooks");
export const COPILOT_GLOBAL_HOOKS_DIR_PATH = COPILOTCLI_HOOKS_DIR_PATH;
export const COPILOTCLI_HOOKS_FILE_NAME = "copilotcli-hooks.json";
// Both GitHub Copilot and the Copilot CLI auto-discover personal/global skills
// from the same `~/.copilot/skills/` location (mirroring the project
// `.github/skills/` layout shared via COPILOT_SKILLS_DIR_PATH), so they share
// this one constant rather than each declaring an identical value.
// https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
export const COPILOT_SKILLS_GLOBAL_DIR_PATH = join(COPILOT_DIR, "skills");
