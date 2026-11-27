import { join } from "node:path";

/**
 * DeepCode (HKUDS) configuration-layout conventions.
 *
 * DeepCode's home is `$DEEPCODE_HOME`, which defaults to `~/.deepcode`;
 * rulesync writes only the default location.
 *
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/configuration.md
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/skills-and-memory.md
 */
export const DEEPCODE_DIR = ".deepcode";

/**
 * The JSON config DeepCode reads at two layers: the user
 * `~/.deepcode/deepcode_config.json` and a project `deepcode_config.json` in
 * the project (or the nearest parent folder that has one), deep-merged over
 * the user file key by key. It carries top-level `mcpServers` and
 * `security.permissions` beside settings rulesync does not own
 * (`security.accessPreset`, `agents`, `goal`, `providers`, `skills`, ...).
 */
export const DEEPCODE_CONFIG_FILE_NAME = "deepcode_config.json";

/** Top-level key of the MCP server map in `deepcode_config.json`. */
export const DEEPCODE_MCP_SERVERS_KEY = "mcpServers";

/** Top-level key of the security block in `deepcode_config.json`. */
export const DEEPCODE_SECURITY_KEY = "security";

/** Key of the per-tool rule map inside `security`. */
export const DEEPCODE_PERMISSIONS_KEY = "permissions";

/**
 * Agent presets: Markdown files with YAML front matter whose file name is the
 * preset id. DeepCode looks in `<project>/.agents/presets/` (and
 * `<project>/.claude/agents/`), then `~/.deepcode/agent-presets/` (and
 * `~/.agents/presets/`, `~/.claude/agents/`). Rulesync writes the
 * DeepCode-named folder in each scope that has one: `.agents/presets/` in a
 * project and `~/.deepcode/agent-presets/` globally.
 */
export const DEEPCODE_PROJECT_PRESETS_DIR_PATH = join(".agents", "presets");
export const DEEPCODE_GLOBAL_PRESETS_DIR_PATH = join(DEEPCODE_DIR, "agent-presets");
