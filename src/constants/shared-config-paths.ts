import { toPosixPath } from "../utils/file.js";

/**
 * Tool outputs that rulesync merges into rather than fully owns (user-managed
 * settings files), as paths relative to the output root. Most come straight from
 * a tool's default `getSettablePaths`; the rest are twins a generator only
 * chooses at write time or under non-default options: `.amp/settings.jsonc`
 * (runtime probe twin of `.amp/settings.json`), `opencode.jsonc` / `kilo.jsonc`
 * (preferred over the `.json` twin when neither file exists yet), and
 * `.claude/settings.local.json` (claudecode ignore `fileMode: "local"`).
 *
 * Two behaviors are derived from this single list:
 *
 * - They are deliberately **not** gitignored (`DERIVED_PATHS_NOT_GITIGNORED` in
 *   `src/cli/commands/gitignore-derive.ts`), because a user may hand-author
 *   settings in them that should stay version-controlled.
 * - Because they are committable, rulesync must not **create** one just to hold
 *   an empty payload — that would be pure `git status` noise. See
 *   `AiFile#shouldSkipCreationWhenPayloadEmpty()`.
 *
 * Paths are stored without the leading "**" glob prefix; the gitignore
 * derivation adds it.
 */
export const SHARED_USER_MANAGED_CONFIG_PATHS: readonly string[] = [
  ".amp/settings.json",
  ".amp/settings.jsonc",
  ".antigravity/settings.json",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".codex/config.toml",
  ".devin/config.json",
  ".factory/settings.json",
  ".grok/config.toml",
  ".vibe/config.toml",
  "reasonix.toml",
  ".vscode/settings.json",
  ".zed/settings.json",
  "kilo.json",
  "kilo.jsonc",
  "opencode.json",
  "opencode.jsonc",
];

/**
 * Whether an output path is one of the shared, user-managed config files above.
 *
 * `relativePath` is the tool-relative path (`relativeDirPath` + file name, POSIX
 * or native separators), never the output root, so the comparison is exact
 * rather than a suffix match. Global-scope outputs are covered exactly when the
 * tool keeps the same relative layout under the home directory (e.g.
 * `~/.claude/settings.json`); a tool that relocates its global file (e.g. Zed's
 * `~/.config/zed/settings.json`) is not matched, which is harmless because the
 * `git status` noise this guards against is project-scope by nature.
 */
export function isSharedUserManagedConfigPath(relativePath: string): boolean {
  const normalized = toPosixPath(relativePath).replace(/^\.\//, "");
  return SHARED_USER_MANAGED_CONFIG_PATHS.includes(normalized);
}
