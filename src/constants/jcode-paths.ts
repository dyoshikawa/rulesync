import { join } from "node:path";

/**
 * jcode configuration-layout conventions.
 *
 * jcode (the Rust coding-agent harness) keeps its project assets under a
 * `.jcode/` directory at the project root and its user assets under
 * `~/.jcode/`. Every jcode file rulesync writes sits at the same relative path
 * in both scopes; the processor supplies the home directory as the output root
 * in global mode. jcode also honors `JCODE_HOME` for the user directory, which
 * rulesync does not follow.
 *
 * @see https://github.com/1jehuang/jcode/blob/master/docs/SYSTEM_PROMPT_CONFIG.md
 */
export const JCODE_DIR = ".jcode";

// Rules. `./.jcode/prompt-overlay.md` (project) and `~/.jcode/prompt-overlay.md`
// (user) are appended to the system prompt after `AGENTS.md`. There is no rules
// directory, so topic rules fold into the single file. The base-prompt
// replacement `system-prompt.md` is deliberately not written.
// @see https://github.com/1jehuang/jcode/blob/master/docs/SYSTEM_PROMPT_CONFIG.md
export const JCODE_RULE_FILE_NAME = "prompt-overlay.md";

// MCP servers. `~/.jcode/mcp.json` (user) and `.jcode/mcp.json` (project, the
// first of the project files jcode loads, before `.mcp.json`).
// @see https://github.com/1jehuang/jcode/blob/master/docs/MCP_REMOTE.md
// @see https://github.com/1jehuang/jcode/blob/master/src/cli/mcp.rs
export const JCODE_MCP_FILE_NAME = "mcp.json";

// Skills: `<name>/SKILL.md` directories under `.jcode/skills/` (project) and
// `~/.jcode/skills/` (user).
// @see https://github.com/1jehuang/jcode/blob/master/crates/jcode-app-core/src/tool/skill.rs
export const JCODE_SKILLS_DIR_PATH = join(JCODE_DIR, "skills");

// Hooks: the `[hooks]` table of the user config `~/.jcode/config.toml`
// (global only; jcode has no project-scoped hooks file).
// @see https://github.com/1jehuang/jcode/blob/master/docs/HOOKS.md
export const JCODE_CONFIG_FILE_NAME = "config.toml";
