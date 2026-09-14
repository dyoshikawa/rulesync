import { join } from "node:path";

// Continue keeps its project-scoped assets under a `.continue/` directory at
// the workspace root and its user-scoped ones under `~/.continue/` (the
// `CONTINUE_GLOBAL_DIR` override is not modelled; rulesync writes the default
// location). Every sub-directory below exists in both trees.
// @see https://docs.continue.dev/customize/deep-dives/rules
// @see https://docs.continue.dev/customize/deep-dives/prompts
// @see https://docs.continue.dev/customize/deep-dives/mcp
export const CONTINUE_DIR = ".continue";

// Rules. The workspace root `AGENTS.md` is Continue's always-applied
// instruction file; additional Markdown rules with frontmatter live under
// `<project>/.continue/rules/` and `~/.continue/rules/`. Continue has no
// user-scoped root file, so the global root rule is written as an `AGENTS.md`
// inside the global rules directory and told apart from the other rules by its
// basename (the same convention the Roo Code target uses).
// @see https://docs.continue.dev/customize/deep-dives/rules
export const CONTINUE_ROOT_RULE_FILE_NAME = "AGENTS.md";
export const CONTINUE_RULES_DIR_PATH = join(CONTINUE_DIR, "rules");

// Prompts (slash commands): Markdown files with an `invokable: true`
// frontmatter under `<project>/.continue/prompts/` and `~/.continue/prompts/`.
// @see https://docs.continue.dev/customize/deep-dives/prompts
export const CONTINUE_PROMPTS_DIR_PATH = join(CONTINUE_DIR, "prompts");

// MCP servers: every `*.json` under `<project>/.continue/mcpServers/` and
// `~/.continue/mcpServers/` is read; rulesync writes the documented `mcp.json`.
// @see https://docs.continue.dev/customize/deep-dives/mcp
export const CONTINUE_MCP_DIR_PATH = join(CONTINUE_DIR, "mcpServers");
export const CONTINUE_MCP_FILE_NAME = "mcp.json";

// Skills: Anthropic-style `<name>/SKILL.md` directories under
// `<project>/.continue/skills/` and `~/.continue/skills/`.
// Not documented on docs.continue.dev yet; the loader is the reference.
// @see https://github.com/continuedev/continue/blob/main/extensions/cli/src/util/loadMarkdownSkills.ts
export const CONTINUE_SKILLS_DIR_PATH = join(CONTINUE_DIR, "skills");

// Hooks: the Claude-Code-compatible `hooks` key of
// `<project>/.continue/settings.json` and `~/.continue/settings.json`, read by
// the Continue CLI (`cn`). Both files also carry unrelated settings, so the key
// is merged in place.
// @see https://github.com/continuedev/continue/tree/main/extensions/cli/src/hooks
export const CONTINUE_SETTINGS_FILE_NAME = "settings.json";

// Permissions: the Continue CLI reads tool policies from the single
// user-scoped `~/.continue/permissions.yaml`; no project file is read.
// @see https://docs.continue.dev/cli/tool-permissions
export const CONTINUE_PERMISSIONS_FILE_NAME = "permissions.yaml";

// Ignore: `.continueignore` at the workspace root plus the user-scoped
// `~/.continue/.continueignore`, both in gitignore syntax.
// @see https://docs.continue.dev/reference/deprecated-codebase
export const CONTINUE_IGNORE_FILE_NAME = ".continueignore";
