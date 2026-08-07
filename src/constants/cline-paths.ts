import { join } from "node:path";

export const CLINE_DIR = ".cline";
export const CLINERULES_DIR = ".clinerules";
export const CLINE_COMMANDS_DIR_PATH = join(CLINERULES_DIR, "workflows");
export const CLINE_COMMANDS_GLOBAL_DIR_PATH = join("Documents", "Cline", "Workflows");
// Global modular rules: read by the VS Code extension AND the SDK/CLI (the
// SDK/CLI additionally reads ~/.cline/rules/), so this is the
// maximally-compatible global rules directory — mirrors the Workflows dir.
export const CLINE_RULES_GLOBAL_DIR_PATH = join("Documents", "Cline", "Rules");
export const CLINE_SKILLS_DIR_PATH = join(CLINE_DIR, "skills");
export const CLINE_AGENTS_DIR_PATH = join(CLINE_DIR, "agents");
export const CLINE_MCP_DIR_PATH = join(CLINE_DIR, "data", "settings");
export const CLINE_MCP_FILE_NAME = "cline_mcp_settings.json";
export const CLINE_PERMISSIONS_FILE_NAME = "command-permissions.json";
export const CLINE_IGNORE_FILE_NAME = ".clineignore";
// File-based hooks: Cline resolves one executable per lifecycle event, named
// exactly after the event, from `<workspace>/.clinerules/hooks/` (project) and
// `~/Documents/Cline/Hooks/` (global) — `resolveHooksDirectory` in
// `apps/vscode/src/core/hooks/utils.ts`.
export const CLINE_HOOKS_DIR_PATH = join(CLINERULES_DIR, "hooks");
export const CLINE_HOOKS_GLOBAL_DIR_PATH = join("Documents", "Cline", "Hooks");
// Manifest of the hook scripts rulesync generated. Cline resolves hooks by
// exact event name, so an extra file in the directory is inert; it gives the
// adapter an owned, diffable, deletable primary file and records which scripts
// belong to rulesync.
export const CLINE_HOOKS_MANIFEST_FILE_NAME = "rulesync-hooks.json";
