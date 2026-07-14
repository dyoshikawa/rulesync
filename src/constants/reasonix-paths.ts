import { join } from "node:path";

// Reasonix resolves config from `./reasonix.toml` (project) and
// `~/.reasonix/config.toml` (global). The project file lives at the repository
// root, while the global file lives inside the `.reasonix` directory.
export const REASONIX_PROJECT_MCP_FILE_NAME = "reasonix.toml";
export const REASONIX_GLOBAL_DIR = ".reasonix";
export const REASONIX_GLOBAL_MCP_FILE_NAME = "config.toml";

// The `[permissions]` table lives in the same shared TOML file as `[[plugins]]`:
// `./reasonix.toml` (project) / `~/.reasonix/config.toml` (global).
export const REASONIX_PROJECT_PERMISSIONS_FILE_NAME = REASONIX_PROJECT_MCP_FILE_NAME;
export const REASONIX_GLOBAL_PERMISSIONS_FILE_NAME = REASONIX_GLOBAL_MCP_FILE_NAME;

// Hooks and commands live under a `.reasonix/` directory relative to the scope
// root: `<project>/.reasonix/` (project) or `~/.reasonix/` (global, via the
// processor's home-relative outputRoot). This is the same directory name as
// `REASONIX_GLOBAL_DIR` above, reused here under a scope-neutral name because,
// unlike MCP/permissions, hooks/commands live under `.reasonix/` in project
// scope too (there is no repository-root file for these features).
export const REASONIX_DIR = REASONIX_GLOBAL_DIR;
// Hooks live in `.reasonix/settings.json` (project) / `~/.reasonix/settings.json`
// (global) — a separate, Claude-Code-style JSON file from `reasonix.toml`.
export const REASONIX_SETTINGS_FILE_NAME = "settings.json";
// Custom slash commands: Markdown files under `.reasonix/commands/` (project) /
// `~/.reasonix/commands/` (global).
export const REASONIX_COMMANDS_DIR_PATH = join(REASONIX_DIR, "commands");

// Reasonix reads `REASONIX.md` as its primary vendor instruction/rules file,
// discovered hierarchically (user-home → ancestors → project root/local). It
// also recognizes the cross-tool `AGENTS.md`/`CLAUDE.md`, but rulesync emits the
// vendor-specific `REASONIX.md` at the project root (project scope) and
// `~/.reasonix/REASONIX.md` (global scope, via the processor's home-relative
// outputRoot under REASONIX_GLOBAL_DIR).
export const REASONIX_RULE_FILE_NAME = "REASONIX.md";

// Skills: Anthropic-style directory-layout skills under `.reasonix/skills/`
// (project) / `~/.reasonix/skills/` (global), each `<name>/SKILL.md`.
export const REASONIX_SKILLS_DIR_PATH = join(REASONIX_DIR, "skills");

// Subagents (Skill profiles with `runAs: subagent`) share the skills directory:
// `.reasonix/skills/<name>/SKILL.md` (project) / `~/.reasonix/skills/<name>/SKILL.md`
// (global). A subagent is just a Skill whose SKILL.md frontmatter declares
// `invocation: manual` and `runAs: subagent`.
// https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SUBAGENT_PROFILES.md
export const REASONIX_SUBAGENTS_DIR_PATH = REASONIX_SKILLS_DIR_PATH;
