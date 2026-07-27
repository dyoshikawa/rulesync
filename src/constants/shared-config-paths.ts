import { toPosixPath } from "../utils/file.js";

/**
 * Project-scope outputs that rulesync merges into rather than fully owns
 * (user-managed settings files). Most paths come straight from a tool's default
 * `getSettablePaths`; `.amp/settings.jsonc` (runtime probe twin of
 * `.amp/settings.json`) and `.claude/settings.local.json` (claudecode ignore
 * `fileMode: "local"` variant) are emitted only under non-default options.
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
];

/**
 * Whether a relative output path (POSIX or native separators) is one of the
 * shared, user-managed config files above. Matches the same any-depth semantics
 * as the derived gitignore entries: the path matches when it is exactly a listed
 * path, or ends with a slash followed by one.
 */
export function isSharedUserManagedConfigPath(relativePath: string): boolean {
  const normalized = toPosixPath(relativePath).replace(/^\.\//, "");
  return SHARED_USER_MANAGED_CONFIG_PATHS.some(
    (path) => normalized === path || normalized.endsWith(`/${path}`),
  );
}
