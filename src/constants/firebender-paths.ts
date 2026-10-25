import { join } from "node:path";

/**
 * Firebender (the coding agent plugin for Android Studio and other JetBrains
 * IDEs) keeps project configuration under `.firebender/` plus a project-root
 * `firebender.json`, and user configuration under `~/.firebender/` (including
 * `~/.firebender/firebender.json`).
 *
 * @see https://docs.firebender.com/api-reference/syntax
 * @see https://docs.firebender.com/api-reference/rules
 * @see https://docs.firebender.com/api-reference/commands
 * @see https://docs.firebender.com/api-reference/agents
 * @see https://docs.firebender.com/api-reference/skills
 * @see https://docs.firebender.com/api-reference/agents-md
 * @see https://docs.firebender.com/multi-agent/hooks
 */
export const FIREBENDER_DIR = ".firebender";

/**
 * `firebender.json`: at the project root for project scope, and under
 * `~/.firebender/` for the personal config. It is shared by the ignore
 * (`ignore`), MCP (`mcpServers`) and subagents (`agents`) features.
 */
export const FIREBENDER_CONFIG_FILE_NAME = "firebender.json";

/** Project-scope directory of `firebender.json` (the project root). */
const FIREBENDER_PROJECT_CONFIG_DIR = ".";

/** `.firebender/AGENTS.md`, the first file Firebender looks for in both scopes. */
export const FIREBENDER_AGENTS_MD_FILE_NAME = "AGENTS.md";

/** Rules: `.firebender/rules/*.mdc` (project) and `~/.firebender/rules/*.mdc` (global). */
export const FIREBENDER_RULES_DIR_PATH = join(FIREBENDER_DIR, "rules");

/** Commands: `.firebender/commands/*.mdc` (project) and `~/.firebender/commands/*.mdc` (global). */
export const FIREBENDER_COMMANDS_DIR_PATH = join(FIREBENDER_DIR, "commands");

/** Agents: Markdown files registered through the `agents` array of `firebender.json`. */
export const FIREBENDER_AGENTS_DIR_NAME = "agents";
export const FIREBENDER_AGENTS_DIR_PATH = join(FIREBENDER_DIR, FIREBENDER_AGENTS_DIR_NAME);

/** Skills: `.firebender/skills/<name>/SKILL.md` (project) and `~/.firebender/skills/` (global). */
export const FIREBENDER_SKILLS_DIR_PATH = join(FIREBENDER_DIR, "skills");

/** Hooks: `.firebender/hooks.json` (project) and `~/.firebender/hooks.json` (global). */
export const FIREBENDER_HOOKS_FILE_NAME = "hooks.json";

/**
 * The directory holding `firebender.json` for a scope: the project root, or
 * `~/.firebender/` for the personal config.
 */
export function getFirebenderConfigDir({ global }: { global: boolean }): string {
  return global ? FIREBENDER_DIR : FIREBENDER_PROJECT_CONFIG_DIR;
}
