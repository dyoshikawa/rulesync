import { join } from "node:path";

/**
 * OpenBitFun configuration-layout conventions.
 *
 * OpenBitFun (formerly BitFun) keeps its project assets under a `.openbitfun/`
 * directory at the project root and its user assets under an OS-dependent
 * user root. Rules are not written here: OpenBitFun already reads the shared
 * `AGENTS.md` / `CLAUDE.md` / `.claude/rules/` files the `agentsmd` and
 * `claudecode` targets write.
 *
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/assembly/core/src/infrastructure/app_paths/path_manager.rs
 */
export const OPENBITFUN_DIR = ".openbitfun";

// Custom agents: Markdown files with YAML frontmatter under `.openbitfun/agents/`
// (project) and `<user root>/agents/` (user).
// @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/execution/agent-runtime/src/custom_agent.rs
const OPENBITFUN_AGENTS_DIR_NAME = "agents";
export const OPENBITFUN_AGENTS_DIR_PATH = join(OPENBITFUN_DIR, OPENBITFUN_AGENTS_DIR_NAME);

// Skills: `<name>/SKILL.md` directories under `.openbitfun/skills/` (project)
// and the user skills directory (see `openbitfunGlobalSkillsDir`).
// @see https://github.com/openBitFun/OpenBitFun/blob/main/docs/interactive-capabilities/capabilities/feature.skills.md
const OPENBITFUN_SKILLS_DIR_NAME = "skills";
export const OPENBITFUN_SKILLS_DIR_PATH = join(OPENBITFUN_DIR, OPENBITFUN_SKILLS_DIR_NAME);

// Hooks: a Codex-shaped `hooks.json` under `.openbitfun/config/` (project) and
// `<user root>/config/` (user). Project hooks only run when OpenBitFun's
// `app.hooks.project_hooks_enabled` setting is on (off by default).
// @see https://github.com/openBitFun/OpenBitFun/blob/main/docs/features/agent-hooks.md
const OPENBITFUN_CONFIG_DIR_NAME = "config";
export const OPENBITFUN_CONFIG_DIR_PATH = join(OPENBITFUN_DIR, OPENBITFUN_CONFIG_DIR_NAME);
export const OPENBITFUN_HOOKS_FILE_NAME = "hooks.json";

const OPENBITFUN_DATA_NAMESPACE = "openbitfun";

/**
 * OpenBitFun's user root (`dirs::config_dir()/openbitfun`), relative to the
 * home directory (the processor resolves the home directory through
 * `outputRoot`).
 *
 * - macOS: `~/Library/Application Support/openbitfun`
 * - Windows: `%APPDATA%\openbitfun` (`~/AppData/Roaming/openbitfun`)
 * - Linux and others: `~/.config/openbitfun`
 *
 * `$XDG_CONFIG_HOME` and OpenBitFun's `OPENBITFUN_USER_ROOT` override are not
 * followed; the default locations are assumed (a non-default `$XDG_CONFIG_HOME`
 * is warned about, see `warnOpenbitfunXdgOverride`).
 */
export function openbitfunGlobalRootDir(): string {
  switch (process.platform) {
    case "darwin":
      return join("Library", "Application Support", OPENBITFUN_DATA_NAMESPACE);
    case "win32":
      return join("AppData", "Roaming", OPENBITFUN_DATA_NAMESPACE);
    default:
      return join(".config", OPENBITFUN_DATA_NAMESPACE);
  }
}

/**
 * OpenBitFun's user agents directory: `<user root>/agents`.
 */
export function openbitfunGlobalAgentsDir(): string {
  return join(openbitfunGlobalRootDir(), OPENBITFUN_AGENTS_DIR_NAME);
}

/**
 * OpenBitFun's user hooks directory: `<user root>/config` (holding `hooks.json`).
 */
export function openbitfunGlobalConfigDir(): string {
  return join(openbitfunGlobalRootDir(), OPENBITFUN_CONFIG_DIR_NAME);
}

/**
 * OpenBitFun's user skills directory (`user_skills_dir` in `path_manager.rs`).
 * It is not always under the user root: on Linux it lives in the data dir
 * (`dirs::data_local_dir()`), not the config dir.
 *
 * - macOS: `~/Library/Application Support/openbitfun/skills`
 * - Windows: `%APPDATA%\openbitfun\skills`
 * - Linux and others: `~/.local/share/openbitfun/skills`
 *
 * `$XDG_DATA_HOME` is not followed; the default location is assumed (a
 * non-default value is warned about, see `warnOpenbitfunXdgOverride`).
 */
export function openbitfunGlobalSkillsDir(): string {
  switch (process.platform) {
    case "darwin":
    case "win32":
      return join(openbitfunGlobalRootDir(), OPENBITFUN_SKILLS_DIR_NAME);
    default:
      return join(".local", "share", OPENBITFUN_DATA_NAMESPACE, OPENBITFUN_SKILLS_DIR_NAME);
  }
}
