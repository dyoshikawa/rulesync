import { join } from "node:path";

/**
 * Pool (Poolside's coding agent CLI) configuration-layout conventions.
 *
 * Pool reads `AGENTS.md` instruction files the same way the AGENTS.md standard
 * describes them: the personal `~/.config/poolside/AGENTS.md` (Pool itself
 * honours `XDG_CONFIG_HOME` upstream; rulesync writes only the XDG-default
 * path), the project-root `AGENTS.md`, and nested per-directory
 * `AGENTS.md` files from the repository root down through the working
 * directory, deeper files taking precedence. It skips ignored directories
 * (`.git/`, `node_modules/`, cache directories, repository ignore rules).
 *
 * Skills follow the Agent Skills format (`<name>/SKILL.md` bundles). Pool
 * scans `.poolside/skills/` (project) and `~/.config/poolside/skills/`
 * (global) plus the shared `.agents/skills/` / `~/.agents/skills/` roots and
 * the skill directories of other Agent Skills tools; rulesync writes only the
 * Pool-specific roots and leaves the shared ones to their own targets.
 *
 * @see https://docs.poolside.ai/agent-instructions
 * @see https://docs.poolside.ai/skills
 * @see https://github.com/poolsideai/pool
 */

/** Project-scoped `.poolside/` directory at the project root. */
export const POOL_DIR = ".poolside";

/** Global config directory for Pool, relative to the home directory. */
export const POOL_GLOBAL_DIR = join(".config", "poolside");

/** Project skills root, relative to the project root. */
export const POOL_SKILLS_DIR_PATH = join(POOL_DIR, "skills");

/** Global skills root, relative to the home directory. */
export const POOL_GLOBAL_SKILLS_DIR_PATH = join(POOL_GLOBAL_DIR, "skills");

/**
 * Pool's settings file name. MCP servers live under the top-level
 * `mcp_servers` key of `.poolside/settings.yaml` (project, committed) and
 * `~/.config/poolside/settings.yaml` (global); the untracked
 * `.poolside/settings.local.yaml` overlay is left to the user.
 *
 * @see https://docs.poolside.ai/mcp-servers
 * @see https://docs.poolside.ai/settings-file-reference
 */
export const POOL_SETTINGS_FILE_NAME = "settings.yaml";

/** Top-level key of Pool's settings file that holds the MCP server map. */
export const POOL_MCP_SERVERS_KEY = "mcp_servers";

/** Top-level key of Pool's settings file that holds per-tool permission rules. */
export const POOL_TOOLS_KEY = "tools";

/** Top-level key of Pool's settings file that holds file access rules. */
export const POOL_PATHS_KEY = "paths";
