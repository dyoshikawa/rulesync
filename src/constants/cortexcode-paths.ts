import { join } from "node:path";

// Snowflake Cortex Code ("CoCo") keeps its project-scoped assets under a
// `.cortex/` directory at the project root and its user-scoped configuration
// under `~/.snowflake/cortex/` (the `SNOWFLAKE_HOME` override is not modelled;
// rulesync writes the default location).
// @see https://docs.snowflake.com/en/user-guide/cortex-code/settings
// @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
export const CORTEXCODE_DIR = ".cortex";
export const CORTEXCODE_GLOBAL_DIR_PATH = join(".snowflake", "cortex");

// Rules. The CLI documents `AGENTS.md` at the project root as its only
// instruction file; no nested or user-scoped rule file is documented for the
// CLI, so rules are project-only and non-root rules fold into the root file.
// @see https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code
export const CORTEXCODE_RULE_FILE_NAME = "AGENTS.md";

// Hooks. The project settings file `<project>/.cortex/settings.json` carries a
// top-level `hooks` key beside other project settings, so it is merged in
// place; the user file `~/.snowflake/cortex/hooks.json` is dedicated to hooks
// and uses the same `{ "hooks": { ... } }` shape.
// @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
export const CORTEXCODE_SETTINGS_FILE_NAME = "settings.json";
export const CORTEXCODE_GLOBAL_HOOKS_FILE_NAME = "hooks.json";

// MCP servers: `~/.snowflake/cortex/mcp.json` only — the CLI documents no
// project-scoped MCP file.
// @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
export const CORTEXCODE_MCP_FILE_NAME = "mcp.json";

// Subagents: Markdown files with frontmatter under `<project>/.cortex/agents/`
// and `~/.snowflake/cortex/agents/`.
// @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
export const CORTEXCODE_AGENTS_DIR_PATH = join(CORTEXCODE_DIR, "agents");
export const CORTEXCODE_GLOBAL_AGENTS_DIR_PATH = join(CORTEXCODE_GLOBAL_DIR_PATH, "agents");

// Skills: Anthropic-style `<name>/SKILL.md` directories under
// `<project>/.cortex/skills/` and `~/.snowflake/cortex/skills/`.
// @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
export const CORTEXCODE_SKILLS_DIR_PATH = join(CORTEXCODE_DIR, "skills");
export const CORTEXCODE_GLOBAL_SKILLS_DIR_PATH = join(CORTEXCODE_GLOBAL_DIR_PATH, "skills");
