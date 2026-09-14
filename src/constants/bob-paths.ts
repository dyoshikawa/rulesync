import { join } from "node:path";

// IBM Bob (Bob IDE, a VS Code-derived agentic IDE, and Bob Shell, its terminal
// agent) keeps every project-scoped asset under a `.bob/` directory at the
// project root, and the matching user-scoped assets under `~/.bob/`.
// @see https://bob.ibm.com/docs/shell/configuration/configuring
export const BOB_DIR = ".bob";

// Rules. Bob auto-loads the cross-tool `AGENTS.md` at the project root and the
// user file `~/.bob/AGENTS.md`, plus every Markdown file under `.bob/rules/`
// (project) and `~/.bob/rules/` (user), read recursively in alphabetical order
// with the workspace overriding the user scope. Rule files are plain Markdown
// with no frontmatter. The mode-specific `.bob/rules-{mode}/` directories and
// the legacy `.bobrules-{mode}` files are not emitted: rulesync has no notion
// of Bob's modes. The user-scoped `~/.bob/AGENTS.md` is documented on the
// Bob Shell configuration page rather than the IDE rules page.
// @see https://bob.ibm.com/docs/ide/configuration/rules
// @see https://bob.ibm.com/docs/shell/configuration/configuring
export const BOB_RULE_FILE_NAME = "AGENTS.md";
export const BOB_RULES_DIR_PATH = join(BOB_DIR, "rules");

// Ignore: a gitignore-syntax `.bobignore` at the workspace root only.
// @see https://bob.ibm.com/docs/ide/configuration/bobignore
export const BOB_IGNORE_FILE_NAME = ".bobignore";

// MCP servers: `<project>/.bob/mcp.json` (project) and `~/.bob/mcp.json`
// (user), both `{ "mcpServers": { ... } }` as Bob IDE documents them. A stdio
// server carries `command`; a remote one carries `type: "streamable-http"` +
// `url`, or a bare `url` for legacy SSE. The project file wins on a name
// clash. (Bob Shell reads its user-scoped servers from `~/.bob/mcp_settings.json`
// with an `httpURL` spelling instead; rulesync accepts that spelling on import
// but does not write that file.)
// @see https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob
// @see https://bob.ibm.com/docs/shell/configuration/mcp/mcp-bobshell
export const BOB_MCP_FILE_NAME = "mcp.json";

// Slash commands: Markdown files under `<project>/.bob/commands/` and
// `~/.bob/commands/`, with optional `description` / `argument-hint`
// frontmatter; the file name is the command name.
// @see https://bob.ibm.com/docs/ide/features/slash-commands
// @see https://bob.ibm.com/docs/shell/features/slash-commands
export const BOB_COMMANDS_DIR_PATH = join(BOB_DIR, "commands");

// Skills: Anthropic-style `<name>/SKILL.md` directories under
// `<project>/.bob/skills/` and `~/.bob/skills/`; the project copy wins on a
// name clash.
// @see https://bob.ibm.com/docs/ide/features/skills
export const BOB_SKILLS_DIR_PATH = join(BOB_DIR, "skills");

// Lifecycle hooks live under the top-level `hooks` key of Bob's settings file:
// `<project>/.bob/settings.json` (project) and `~/.bob/settings/settings.json`
// (user). The file holds other user-managed settings too, so rulesync merges
// the `hooks` key into it instead of overwriting the file.
// @see https://bob.ibm.com/docs/ide/configuration/lifecycle-hooks
export const BOB_SETTINGS_FILE_NAME = "settings.json";
export const BOB_GLOBAL_SETTINGS_DIR_PATH = join(BOB_DIR, "settings");
