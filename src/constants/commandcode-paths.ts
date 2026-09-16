import { join } from "node:path";

// Command Code (`command-code` on npm, the open-source terminal coding agent
// from CommandCodeAI) keeps every project-scoped asset under a `.commandcode/`
// directory at the project root and the matching user-scoped assets under
// `~/.commandcode/`.
// @see https://commandcode.ai/docs
export const COMMANDCODE_DIR = ".commandcode";

// Rules. Command Code loads the project `AGENTS.md` at the repository root
// (falling back to `.commandcode/AGENTS.md` only when the root file is absent)
// and the user `~/.commandcode/AGENTS.md`. Subdirectory `AGENTS.md` files are
// pulled in lazily when the agent reads a file under them, so there is no
// deterministic nested rules surface to emit; non-root rules fold into the
// root file.
// @see https://commandcode.ai/docs/memory
export const COMMANDCODE_RULE_FILE_NAME = "AGENTS.md";

// Settings. `.commandcode/settings.json` (project) and
// `~/.commandcode/settings.json` (user) carry the `hooks` and `permissions`
// keys beside other user-tunable settings, so rulesync merges its keys in
// place and leaves the siblings alone.
// @see https://commandcode.ai/docs/hooks
// @see https://commandcode.ai/docs/permissions
export const COMMANDCODE_SETTINGS_FILE_NAME = "settings.json";
// The personal, gitignored settings layer beside it: `--local` approvals and
// per-developer overrides land in `.commandcode/settings.local.json`. rulesync
// never writes it, but a repository is likely to have one.
// @see https://commandcode.ai/docs/permissions
export const COMMANDCODE_SETTINGS_LOCAL_FILE_NAME = "settings.local.json";

// MCP servers. The project file is `.mcp.json` at the repository root (the
// same file Claude Code reads); the user file is `~/.commandcode/mcp.json`.
// @see https://commandcode.ai/docs/mcp
export const COMMANDCODE_PROJECT_MCP_FILE_NAME = ".mcp.json";
export const COMMANDCODE_GLOBAL_MCP_FILE_NAME = "mcp.json";

// Custom slash commands: Markdown files under `.commandcode/commands/`
// (project) and `~/.commandcode/commands/` (user); subdirectories are allowed
// and only group the files — the command name is the file's basename.
// @see https://commandcode.ai/docs/custom-slash-commands
export const COMMANDCODE_COMMANDS_DIR_PATH = join(COMMANDCODE_DIR, "commands");

// Subagents: Markdown files with YAML frontmatter under
// `.commandcode/agents/` (project) and `~/.commandcode/agents/` (user).
// @see https://commandcode.ai/docs/custom-agents
export const COMMANDCODE_AGENTS_DIR_PATH = join(COMMANDCODE_DIR, "agents");

// Skills: Anthropic-style `<name>/SKILL.md` directories under
// `.commandcode/skills/` (project) and `~/.commandcode/skills/` (user).
// @see https://commandcode.ai/docs/skills
export const COMMANDCODE_SKILLS_DIR_PATH = join(COMMANDCODE_DIR, "skills");
