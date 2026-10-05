import { join } from "node:path";

/**
 * CodeBuddy Code configuration-layout conventions.
 *
 * CodeBuddy Code (`@tencent-ai/codebuddy-code`) is Tencent Cloud's terminal
 * coding agent. Its configuration surface mirrors Claude Code closely: a
 * root memory file plus a `.codebuddy/` tree.
 *
 * @see https://www.codebuddy.ai/docs/cli/memory
 * @see https://www.codebuddy.ai/docs/cli/codebuddy-dir
 */

/** Root directory for CodeBuddy Code configuration, relative to the scope root. */
export const CODEBUDDY_DIR = ".codebuddy";

// Rules (memory) files. The root memory file lives at the project root (or
// under `.codebuddy/` as an alternative root / in global scope).
export const CODEBUDDY_RULE_FILE_NAME = "CODEBUDDY.md";
export const CODEBUDDY_LOCAL_RULE_FILE_NAME = "CODEBUDDY.local.md";
/** Modular rules directory name under `.codebuddy/`. */
export const CODEBUDDY_RULES_DIR_NAME = "rules";

// Skills: `<name>/SKILL.md` directories under `.codebuddy/skills/` (project)
// and `~/.codebuddy/skills/` (user).
// @see https://www.codebuddy.ai/docs/cli/skills
export const CODEBUDDY_SKILLS_DIR_PATH = join(CODEBUDDY_DIR, "skills");

// Subagents: one Markdown file with YAML frontmatter per agent under
// `.codebuddy/agents/` (project) and `~/.codebuddy/agents/` (user).
// @see https://www.codebuddy.ai/docs/cli/sub-agents
export const CODEBUDDY_AGENTS_DIR_PATH = join(CODEBUDDY_DIR, "agents");

// Custom slash commands: Markdown files under `.codebuddy/commands/` (project,
// subdirectories group commands) and `~/.codebuddy/commands/` (user).
// @see https://www.codebuddy.ai/docs/cli/slash-commands
export const CODEBUDDY_COMMANDS_DIR_PATH = join(CODEBUDDY_DIR, "commands");

// Settings: `.codebuddy/settings.json` (project, committed) and
// `~/.codebuddy/settings.json` (user) hold the `hooks` and `permissions` keys
// beside every other CodeBuddy setting. The gitignored
// `.codebuddy/settings.local.json` layer is CodeBuddy's own and never written.
// @see https://www.codebuddy.ai/docs/cli/settings
export const CODEBUDDY_SETTINGS_FILE_NAME = "settings.json";

// MCP servers: `<project>/.mcp.json` (the same file Claude Code reads) and
// `~/.codebuddy/.mcp.json` (user; `~/.codebuddy/mcp.json` and
// `~/.codebuddy.json` are deprecated / legacy fallbacks CodeBuddy only reads
// when the recommended file is absent).
// @see https://www.codebuddy.ai/docs/cli/mcp
export const CODEBUDDY_MCP_FILE_NAME = ".mcp.json";
