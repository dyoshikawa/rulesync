import { join } from "node:path";

// ZCode (Z.ai's Agentic Development Environment for the GLM family) keeps every
// workspace-scoped asset under a `.zcode/` directory at the project root, and
// the matching user-scoped assets under `~/.zcode/`.
// @see https://zcode.z.ai/en/docs
export const ZCODE_DIR = ".zcode";

// Project instructions. ZCode reads the cross-tool `AGENTS.md` standard: the
// workspace file at the project root and the user file at `~/.zcode/AGENTS.md`,
// appended in that order. It explicitly does not merge `AGENTS.md` across
// directory levels and does not scan child directories, so — unlike the
// AGENTS.md standard itself — there is no nested rules surface to emit.
// @see https://zcode.z.ai/en/docs/agents
export const ZCODE_RULE_FILE_NAME = "AGENTS.md";

// Custom slash commands: Markdown files under `<project>/.zcode/commands/`
// (workspace scope) and `~/.zcode/commands/` (user scope), invoked with `/`.
// @see https://zcode.z.ai/en/docs/commands
export const ZCODE_COMMANDS_DIR_PATH = join(ZCODE_DIR, "commands");

// Skills: Anthropic-style directory-layout skills, each `<name>/SKILL.md`,
// invoked with `$`. The documented path is the user one,
// `~/.zcode/skills/<name>/SKILL.md`; the workspace scope the import dialog
// offers ("Global … or the current Project") mirrors it under the project's own
// `.zcode/`, the same way commands do.
// @see https://zcode.z.ai/en/docs/skill
export const ZCODE_SKILLS_DIR_PATH = join(ZCODE_DIR, "skills");

// MCP servers live under the `mcp.servers` key of ZCode's own JSON config:
// `<project>/.zcode/config.json` (workspace) and `~/.zcode/cli/config.json`
// (user). The legacy `.agents/mcp.json` fallback is read only while no MCP
// server is found in the `.zcode` file of the same scope, so rulesync writes
// the native location and leaves the fallback alone.
// @see https://zcode.z.ai/en/docs/mcp-services
export const ZCODE_CONFIG_FILE_NAME = "config.json";
export const ZCODE_GLOBAL_CONFIG_DIR_PATH = join(ZCODE_DIR, "cli");
export const ZCODE_MCP_CONFIG_KEY = "mcp";
export const ZCODE_MCP_SERVERS_KEY = "servers";
