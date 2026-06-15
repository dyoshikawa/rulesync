import { join } from "node:path";

/**
 * Claude Code configuration-layout conventions.
 *
 * Single source of truth for where Claude Code expects its files
 * (directories, file names, scope-specific paths). Every feature module
 * (rules, commands, skills, subagents, ignore, mcp, permissions, hooks)
 * and the gitignore entry registry import from here, so a change in the
 * Claude Code conventions is a change to this file only.
 */

/** Root directory for Claude Code configuration, relative to the scope root. */
export const CLAUDECODE_DIR = ".claude";

// Rules (memory) files. The root memory file lives at the project root
// (or under `.claude/` as an alternative root / in global scope).
export const CLAUDECODE_RULE_FILE_NAME = "CLAUDE.md";
export const CLAUDECODE_LOCAL_RULE_FILE_NAME = "CLAUDE.local.md";
/** Modular rules directory name under `.claude/` (current format). */
export const CLAUDECODE_RULES_DIR_NAME = "rules";
/** Memories directory name under `.claude/` (legacy format). */
export const CLAUDECODE_MEMORIES_DIR_NAME = "memories";

// Feature directories under `.claude/`.
export const CLAUDECODE_COMMANDS_DIR_PATH = join(CLAUDECODE_DIR, "commands");
export const CLAUDECODE_AGENTS_DIR_PATH = join(CLAUDECODE_DIR, "agents");
export const CLAUDECODE_SKILLS_DIR_PATH = join(CLAUDECODE_DIR, "skills");
export const CLAUDECODE_SCHEDULED_TASKS_DIR_PATH = join(CLAUDECODE_DIR, "scheduled-tasks");

// Settings files under `.claude/`, shared by the hooks, permissions and
// ignore (permissions deny list) features.
export const CLAUDECODE_SETTINGS_FILE_NAME = "settings.json";
export const CLAUDECODE_SETTINGS_LOCAL_FILE_NAME = "settings.local.json";

// MCP configuration files. Both live at the scope root, not under `.claude/`:
// `.mcp.json` at the project root, `.claude.json` at the home directory.
export const CLAUDECODE_MCP_FILE_NAME = ".mcp.json";
export const CLAUDECODE_GLOBAL_MCP_FILE_NAME = ".claude.json";
