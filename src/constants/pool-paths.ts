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
 * @see https://docs.poolside.ai/agent-instructions
 * @see https://github.com/poolsideai/pool
 */

/** Global config directory for Pool, relative to the home directory. */
export const POOL_GLOBAL_DIR = join(".config", "poolside");
