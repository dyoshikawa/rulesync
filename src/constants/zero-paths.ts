import { join } from "node:path";

/**
 * Zero (`Twigpine/zero`) configuration-layout conventions.
 *
 * Zero keeps its project assets under a `.zero/` directory at the project root
 * and its user assets under `<user config dir>/zero/`: `~/.config/zero/` on
 * Linux and macOS (Zero deliberately uses `~/.config` on macOS too) and
 * `%AppData%\zero\` on Windows.
 *
 * @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md
 * @see https://github.com/Twigpine/zero/blob/main/internal/config/paths.go
 */
export const ZERO_DIR = ".zero";

// Project instructions: at each directory level from the git root down to the
// working directory, Zero reads the first of `AGENTS.md`, `ZERO.md` and
// `.zero/AGENTS.md` that exists. `ZERO.md` is Zero's own file name; the
// user-level `ZERO.md` sits in the user config directory.
// @see https://github.com/Twigpine/zero/blob/main/internal/agent/system_prompt.go
export const ZERO_RULE_FILE_NAME = "ZERO.md";
export const ZERO_AGENTSMD_FILE_NAME = "AGENTS.md";

// Zero caps each instruction file at 8 KiB and drops what is past the cap.
// @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md
export const ZERO_INSTRUCTION_FILE_MAX_BYTES = 8 * 1024;

// Specialists (subagents): one Markdown manifest per specialist under
// `.zero/specialists/` (project) and `<user config dir>/zero/specialists/`.
// @see https://github.com/Twigpine/zero/blob/main/docs/SPECIALISTS.md
const ZERO_SPECIALISTS_DIR_NAME = "specialists";
export const ZERO_SPECIALISTS_DIR_PATH = join(ZERO_DIR, ZERO_SPECIALISTS_DIR_NAME);

// Hooks: `.zero/hooks.json` (project) and `<user config dir>/zero/hooks.json`.
// @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md#4-hooks
export const ZERO_HOOKS_FILE_NAME = "hooks.json";

// MCP servers live under `mcp.servers` of Zero's JSON config:
// `.zero/config.json` (project) and `<user config dir>/zero/config.json`.
// @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md#5-mcp--model-context-protocol
export const ZERO_CONFIG_FILE_NAME = "config.json";
export const ZERO_MCP_CONFIG_KEY = "mcp";
export const ZERO_MCP_SERVERS_KEY = "servers";

// Skills: the primary skills root is `$ZERO_SKILLS_DIR`, else
// `$XDG_DATA_HOME/zero/skills`, else `~/.local/share/zero/skills` on every
// platform. Standalone project skill directories are not supported.
// @see https://github.com/Twigpine/zero/blob/main/internal/skills/skills.go
export const ZERO_GLOBAL_SKILLS_DIR_PATH = join(".local", "share", "zero", "skills");

const ZERO_NAMESPACE = "zero";

/**
 * Zero's user config directory (`config.UserConfigDir()/zero`), relative to the
 * home directory (the processor resolves the home directory through
 * `outputRoot`).
 *
 * - Windows: `%AppData%\zero` (`~/AppData/Roaming/zero`)
 * - Linux, macOS and others: `~/.config/zero`
 *
 * `$XDG_CONFIG_HOME` is not followed; the default location is assumed.
 *
 * @see https://github.com/Twigpine/zero/blob/main/internal/config/paths.go
 */
export function zeroGlobalConfigDir(): string {
  return process.platform === "win32"
    ? join("AppData", "Roaming", ZERO_NAMESPACE)
    : join(".config", ZERO_NAMESPACE);
}

/**
 * The user config directory of the OTHER platform family. {@link zeroGlobalConfigDir}
 * resolves one spelling per platform, but the shared-write derivation (and
 * the gateway ownership table it is checked against) must know both.
 */
export function zeroOtherPlatformGlobalConfigDir(): string {
  return process.platform === "win32"
    ? join(".config", ZERO_NAMESPACE)
    : join("AppData", "Roaming", ZERO_NAMESPACE);
}

/**
 * Zero's user specialists directory: `<user config dir>/zero/specialists`.
 */
export function zeroGlobalSpecialistsDir(): string {
  return join(zeroGlobalConfigDir(), ZERO_SPECIALISTS_DIR_NAME);
}
