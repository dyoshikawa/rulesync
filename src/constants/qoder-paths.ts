import { join } from "node:path";

/**
 * Qoder configuration-layout conventions.
 *
 * Qoder (Alibaba's agentic coding platform: the Qoder desktop IDE, the
 * `qodercli` terminal agent and the JetBrains plugin) keeps every project
 * asset under a `.qoder/` directory at the project root and the matching user
 * assets under `~/.qoder/` (relocatable with `QODER_CONFIG_DIR`). The IDE and
 * the CLI share both trees, so a single `qoder` target covers them.
 *
 * @see https://docs.qoder.com/en/cli/02-core-concepts/qoder-directory
 */
export const QODER_DIR = ".qoder";

// Rules (static memory). The project `AGENTS.md` sits at the project root, the
// user one at `~/.qoder/AGENTS.md`, and `AGENTS.local.md` is the per-machine
// overlay beside the project file. Topic rules are Markdown files under
// `.qoder/rules/` (project) and `~/.qoder/rules/` (user).
// @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/memory
export const QODER_RULE_FILE_NAME = "AGENTS.md";
export const QODER_LOCAL_RULE_FILE_NAME = "AGENTS.local.md";
export const QODER_RULES_DIR_PATH = join(QODER_DIR, "rules");

// Settings. `~/.qoder/settings.json` (user) carries the user MCP servers in its
// `mcpServers` key beside every other Qoder setting, so rulesync merges that
// key in place.
// @see https://docs.qoder.com/en/cli/02-core-concepts/qoder-directory
export const QODER_SETTINGS_FILE_NAME = "settings.json";

// MCP servers. The project file is `.mcp.json` at the project root (the file
// documented as "usually committed with the project", the same one Claude Code
// reads); user servers live in `~/.qoder/settings.json`.
// @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/mcp-servers
export const QODER_PROJECT_MCP_FILE_NAME = ".mcp.json";

// Custom slash commands: Markdown files under `.qoder/commands/` (project) and
// `~/.qoder/commands/` (user). The invocation name comes from the file path;
// subdirectories namespace with `:` (`commands/git/commit.md` is `/git:commit`).
// @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/command
export const QODER_COMMANDS_DIR_PATH = join(QODER_DIR, "commands");

// Subagents: Markdown files with YAML frontmatter under `.qoder/agents/`
// (project) and `~/.qoder/agents/` (user).
// @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/subagent
export const QODER_AGENTS_DIR_PATH = join(QODER_DIR, "agents");

// Skills: `<name>/SKILL.md` directories under `.qoder/skills/` (project) and
// `~/.qoder/skills/` (user).
// @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/Skills
export const QODER_SKILLS_DIR_PATH = join(QODER_DIR, "skills");

// Ignore file: `.qoderignore` at the project root, in gitignore syntax. Qoder
// IDE excludes the listed paths from codebase indexing (beside `.gitignore`).
// @see https://docs.qoder.com/user-guide/indexing
export const QODER_IGNORE_FILE_NAME = ".qoderignore";
