import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import {
  WARP_DIR,
  WARP_LINUX_DIR,
  WARP_PERMISSIONS_FILE_NAME,
  WARP_WIN32_DIR,
} from "../../constants/warp-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  collectShellCommandRules,
  partitionCommandRules,
  warnAboutUnwrittenCommandRules,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const WARP_GLOBAL_ONLY_MESSAGE =
  "Warp permissions are global-only; use --global to sync Warp's settings.toml";

// Legacy keys under the `[agents.profiles]` table that hold the command
// permission regex arrays. Since file-backed execution profiles went Stable
// (2026-07-28) these are consumed only once by Warp's one-shot migration into
// the `default` execution profile and are otherwise ignored — they are still
// written for un-migrated installs and old clients, but can no longer be the
// only output. https://docs.warp.dev/agent-platform/capabilities/agent-profiles-permissions/
const ALLOWLIST_KEY = "agent_mode_command_execution_allowlist";
const DENYLIST_KEY = "agent_mode_command_execution_denylist";

// Current permission surface: the `[agents.execution_profiles.<id>]` collection
// in `settings.toml`. Runtime allow/denylist enforcement reads the active
// execution profile; the reserved `default` key identifies the default profile.
// Profiles fill missing fields with defaults on load, so a partial record
// stays valid.
// https://github.com/warpdotdev/warp/blob/main/specs/file-backed-execution-profile-collection/TECH.md
const EXECUTION_PROFILES_KEY = "execution_profiles";
const DEFAULT_PROFILE_KEY = "default";
const PROFILE_ALLOWLIST_KEY = "command_allowlist";
const PROFILE_DENYLIST_KEY = "command_denylist";

// File-read/read-only autonomy keys under `[agents.profiles]` that the `warp`
// override authors and that round-trip back into it on import. rulesync still
// fully owns the command allow/denylist arrays via the shared block.
const WARP_OVERRIDE_KEYS = [
  "agent_mode_coding_permissions",
  "agent_mode_coding_file_read_allowlist",
  "agent_mode_execute_readonly_commands",
] as const;

// Permission keys of the `default` execution profile that the nested
// `warp.execution_profile` override authors and that round-trip back into it
// on import (`ExecutionProfileFile` in the Warp repository's
// `app/src/ai/execution_profiles/config.rs`). Profile-management keys (name,
// model overrides, context window limit, plan sync, web search toggle) are
// deliberately not lifted — they are not permissions.
const WARP_EXECUTION_PROFILE_OVERRIDE_KEY = "execution_profile";
const WARP_EXECUTION_PROFILE_KEYS = [
  "read_files",
  "apply_code_diffs",
  "execute_commands",
  "mcp_permissions",
  "write_to_pty",
  "ask_user_question",
  "run_agents",
  "computer_use",
  "directory_allowlist",
  "mcp_allowlist",
  "mcp_denylist",
] as const;

/**
 * Warp's `settings.toml` lives in a different directory per platform (Stable
 * channel). The home directory is resolved by the processor through
 * `outputRoot`, so only the home-relative directory is returned here.
 *
 * - macOS: `~/.warp/settings.toml`
 * - Linux: `~/.config/warp-terminal/settings.toml`
 * - Windows: `%LOCALAPPDATA%\warp\Warp\config\settings.toml` (`%LOCALAPPDATA%`
 *   is `~/AppData/Local`)
 *
 * @see https://docs.warp.dev/terminal/settings/file-locations/
 */
function warpSettingsDir(): string {
  switch (process.platform) {
    case "darwin":
      return WARP_DIR;
    case "win32":
      return WARP_WIN32_DIR;
    default:
      return WARP_LINUX_DIR;
  }
}

/**
 * Permissions adapter for Warp.
 *
 * Warp gates **shell command** execution through two regex arrays in the
 * global user `settings.toml`. Since file-backed execution profiles went
 * Stable (2026-07-28) the authoritative surface is the `default` record of the
 * `[agents.execution_profiles.<id>]` collection:
 * - `command_allowlist` — commands that auto-execute.
 * - `command_denylist` — commands that always require permission (the denylist
 *   wins over the allowlist). Writing it at all replaces Warp's built-in
 *   default denylist, so rulesync warns whenever it emits a non-empty one.
 *   https://docs.warp.dev/cli/permissions-and-profiles/
 *
 * The legacy `[agents.profiles]` keys
 * (`agent_mode_command_execution_allowlist` / `denylist`) are consumed only
 * once by Warp's one-shot migration and are ignored afterwards. Both surfaces
 * are written: the legacy block keeps un-migrated installs and old clients
 * working, and the `default` execution profile (merged in place, only when the
 * collection already exists) keeps migrated installs enforcing the lists.
 * Import prefers the execution profile and falls back to the legacy keys.
 *
 * This surface is **global only** — there is no project-scoped Warp permissions
 * file. rulesync's canonical `permission.bash` patterns map directly (`allow` →
 * allowlist, `deny` → denylist). Warp matches commands with regular
 * expressions, so patterns are emitted verbatim — author canonical `bash`
 * patterns as regexes when targeting Warp (mirrors the Zed permissions
 * adapter). Warp has no per-command "ask" list, so `ask` rules write nothing —
 * they only withhold the allow rules they cover, since the stricter rule wins
 * whatever its width. The all-tools `*` category is read for its restricting
 * rules as well, but those only withhold allows too: writing any denylist
 * **replaces** Warp's built-in default one, and a `*` pattern need not name a
 * command at all. Categories other than `bash` and `*` are skipped (with a
 * warning when they carry `deny` rules).
 *
 * Warp's `[agents.profiles]` table also exposes file-read/read-only autonomy
 * knobs that do not fit the canonical `allow | ask | deny` per-command model:
 * `agent_mode_coding_permissions`, `agent_mode_coding_file_read_allowlist`, and
 * `agent_mode_execute_readonly_commands`. These are authored and round-tripped
 * through the `warp` override namespace (see `WarpPermissionsOverrideSchema`):
 * on **import** they are lifted from `settings.toml` into the override, and on
 * **export** they are merged back into `[agents.profiles]` (the override wins).
 *
 * On migrated installs those legacy keys are inert; their execution-profile
 * counterparts (`read_files` / `apply_code_diffs` / `execute_commands`
 * action permissions, `directory_allowlist`, `mcp_allowlist` /
 * `mcp_denylist`) are authored through the nested `warp.execution_profile`
 * override, merged into the `default` record of
 * `[agents.execution_profiles.<id>]` under the same collection-exists guard as
 * the command lists, and lifted back from the `default` profile on import.
 *
 * The `settings.toml` file holds all of Warp's settings, so the
 * `[agents.profiles]` block is merged in place and the file is never deleted.
 */
export class WarpPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: warpSettingsDir(),
      relativeFilePath: WARP_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<WarpPermissions> {
    if (!global) {
      throw new Error(WARP_GLOBAL_ONLY_MESSAGE);
    }
    const paths = WarpPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new WarpPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global: true,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<WarpPermissions> {
    if (!global) {
      throw new Error(WARP_GLOBAL_ONLY_MESSAGE);
    }
    const paths = WarpPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // global settings.toml as a side effect (mirrors the Zed adapter).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let settings: Record<string, unknown>;
    try {
      settings = smolToml.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Warp settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, deny } = convertRulesyncToWarpPermissions({ config, logger });

    // Merge into `[agents.profiles]`, preserving other agents/profiles keys
    // (e.g. `agent_mode_coding_permissions`, `agents.warp_agent`).
    const agents = isRecord(settings.agents) ? { ...settings.agents } : {};
    const profiles = isRecord(agents.profiles) ? { ...agents.profiles } : {};

    // Overlay the Warp-scoped override's autonomy keys onto `[agents.profiles]`
    // first (verbatim, so forward-compat keys pass through), then set the
    // rulesync-owned command lists below so they always win over the override.
    // The nested `execution_profile` block targets the execution-profile
    // collection instead and must not leak into `[agents.profiles]`.
    const override = config.warp;
    const executionProfileOverride =
      isRecord(override) && isRecord(override[WARP_EXECUTION_PROFILE_OVERRIDE_KEY])
        ? override[WARP_EXECUTION_PROFILE_OVERRIDE_KEY]
        : undefined;
    if (isRecord(override)) {
      const { [WARP_EXECUTION_PROFILE_OVERRIDE_KEY]: _executionProfile, ...legacyOverride } =
        override;
      Object.assign(profiles, legacyOverride);
    }

    const mergedAllow = uniq(allow.toSorted());
    const mergedDeny = uniq(deny.toSorted());
    if (mergedAllow.length > 0) {
      profiles[ALLOWLIST_KEY] = mergedAllow;
    } else {
      delete profiles[ALLOWLIST_KEY];
    }
    if (mergedDeny.length > 0) {
      profiles[DENYLIST_KEY] = mergedDeny;
    } else {
      delete profiles[DENYLIST_KEY];
    }

    agents.profiles = profiles;

    if (mergedDeny.length > 0 && logger) {
      logger.warn(
        `Warp's command_denylist replaces its built-in default denylist, which covers rm, curl, ` +
          `wget, eval, ssh, shells, and other risky command patterns. The ${mergedDeny.length} ` +
          `deny rule(s) from .rulesync/permissions.jsonc are now the whole denylist — add ` +
          `equivalents for the built-in patterns you want to keep.`,
      );
    }

    mergeIntoDefaultExecutionProfile({
      agents,
      mergedAllow,
      mergedDeny,
      executionProfileOverride,
      logger,
    });

    settings.agents = agents;

    return new WarpPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(settings as smolToml.TomlTable),
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: Record<string, unknown>;
    try {
      settings = smolToml.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Warp permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const agents = isRecord(settings.agents) ? settings.agents : {};
    const profiles = isRecord(agents.profiles) ? agents.profiles : {};

    // Prefer the current surface: on a migrated install the `default`
    // execution profile is what runtime enforcement actually reads, and its
    // command lists may have diverged from the stale legacy keys. Fall back to
    // the legacy `[agents.profiles]` keys only when there is no `default`
    // execution-profile record (an un-migrated install; a collection without
    // `default` is invalid to Warp and treated the same way).
    const executionProfiles = isRecord(agents[EXECUTION_PROFILES_KEY])
      ? agents[EXECUTION_PROFILES_KEY]
      : undefined;
    const defaultProfile =
      executionProfiles && isRecord(executionProfiles[DEFAULT_PROFILE_KEY])
        ? executionProfiles[DEFAULT_PROFILE_KEY]
        : undefined;

    const allow = defaultProfile
      ? isStringArray(defaultProfile[PROFILE_ALLOWLIST_KEY])
        ? defaultProfile[PROFILE_ALLOWLIST_KEY]
        : []
      : isStringArray(profiles[ALLOWLIST_KEY])
        ? profiles[ALLOWLIST_KEY]
        : [];
    const deny = defaultProfile
      ? isStringArray(defaultProfile[PROFILE_DENYLIST_KEY])
        ? defaultProfile[PROFILE_DENYLIST_KEY]
        : []
      : isStringArray(profiles[DENYLIST_KEY])
        ? profiles[DENYLIST_KEY]
        : [];

    const config = convertWarpToRulesyncPermissions({ allow, deny });

    // Route Warp's file-read/read-only autonomy keys into the `warp` override —
    // they have no canonical category and would otherwise be dropped.
    const warpOverride: Record<string, unknown> = {};
    for (const key of WARP_OVERRIDE_KEYS) {
      if (profiles[key] !== undefined) warpOverride[key] = profiles[key];
    }

    // Lift the `default` execution profile's autonomy keys into the nested
    // `execution_profile` override so they round-trip on migrated installs.
    if (defaultProfile) {
      const executionProfileOverride: Record<string, unknown> = {};
      for (const key of WARP_EXECUTION_PROFILE_KEYS) {
        if (defaultProfile[key] !== undefined) executionProfileOverride[key] = defaultProfile[key];
      }
      if (Object.keys(executionProfileOverride).length > 0) {
        warpOverride[WARP_EXECUTION_PROFILE_OVERRIDE_KEY] = executionProfileOverride;
      }
    }

    const result: Record<string, unknown> = { ...config };
    if (Object.keys(warpOverride).length > 0) {
      result.warp = warpOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): WarpPermissions {
    return new WarpPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global: true,
    });
  }
}

/**
 * On migrated installs the legacy `[agents.profiles]` keys are inert: runtime
 * enforcement reads the active `[agents.execution_profiles.<id>]` record.
 * Merge the command lists (and the `warp.execution_profile` override's
 * autonomy keys) into the `default` profile in place so every other profile
 * key and profile ID survives. When the collection does not exist yet the
 * install is un-migrated — the legacy keys are still live there, and creating
 * the collection ourselves would mark Warp's one-shot migration complete early
 * and strand the user's other legacy settings (file-read allowlist, preferred
 * model), so it is deliberately left unset and the override is skipped with a
 * warning instead.
 */
function mergeIntoDefaultExecutionProfile({
  agents,
  mergedAllow,
  mergedDeny,
  executionProfileOverride,
  logger,
}: {
  agents: Record<string, unknown>;
  mergedAllow: string[];
  mergedDeny: string[];
  executionProfileOverride: Record<string, unknown> | undefined;
  logger?: Logger;
}): void {
  const hasOverrideKeys =
    executionProfileOverride !== undefined && Object.keys(executionProfileOverride).length > 0;

  if (!isRecord(agents[EXECUTION_PROFILES_KEY])) {
    if (hasOverrideKeys && logger) {
      logger.warn(
        `The warp.execution_profile permissions override was skipped: settings.toml has no ` +
          `[agents.execution_profiles] collection yet (un-migrated install). Open Warp once to ` +
          `run its settings migration, then re-run rulesync generate.`,
      );
    }
    return;
  }

  const executionProfiles = { ...agents[EXECUTION_PROFILES_KEY] };
  const defaultProfile = isRecord(executionProfiles[DEFAULT_PROFILE_KEY])
    ? { ...executionProfiles[DEFAULT_PROFILE_KEY] }
    : {};
  // Autonomy keys from the `warp.execution_profile` override merge first
  // (verbatim, so forward-compat keys like `write_to_pty` pass through); the
  // rulesync-owned command lists below always win over the override.
  if (executionProfileOverride) {
    Object.assign(defaultProfile, executionProfileOverride);
  }
  if (mergedAllow.length > 0) {
    defaultProfile[PROFILE_ALLOWLIST_KEY] = mergedAllow;
  } else {
    delete defaultProfile[PROFILE_ALLOWLIST_KEY];
  }
  if (mergedDeny.length > 0) {
    defaultProfile[PROFILE_DENYLIST_KEY] = mergedDeny;
  } else {
    delete defaultProfile[PROFILE_DENYLIST_KEY];
  }
  executionProfiles[DEFAULT_PROFILE_KEY] = defaultProfile;
  agents[EXECUTION_PROFILES_KEY] = executionProfiles;

  // Runtime enforcement reads the *active* profile, and rulesync manages only
  // `default` — deny rules and override keys are silently unenforced while
  // another profile is active, which is worth a heads-up.
  const otherProfileIds = Object.keys(executionProfiles).filter((id) => id !== DEFAULT_PROFILE_KEY);
  if ((mergedDeny.length > 0 || hasOverrideKeys) && otherProfileIds.length > 0 && logger) {
    logger.warn(
      `Warp command deny rules and execution_profile override keys were written to the ` +
        `'default' execution profile only; they are not enforced while another profile ` +
        `(${otherProfileIds.join(", ")}) is active.`,
    );
  }
}

/**
 * Read a `[...]` class starting at its `[` and return the index just past its
 * `]`, or `undefined` when it cannot be read that simply. Regex class rules
 * apply: a `]` in the first position is a member rather than the terminator and
 * a backslash escapes the character after it. A nested `[` gives up: Rust's
 * `regex` crate — the engine Warp matches with — reads `[a[b]c]` as one class
 * built by set operations, so stopping at the first `]` would leave `c]` behind
 * as text the glob then requires. Giving up widens the whole pattern instead,
 * which is the only safe direction here.
 */
function skipRegexClass(body: string, start: number): number | undefined {
  let index = start + 1;
  if (body.charAt(index) === "^") {
    index += 1;
  }
  if (body.charAt(index) === "]") {
    index += 1;
  }
  while (index < body.length) {
    const character = body.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[") {
      return undefined;
    }
    if (character === "]") {
      return index + 1;
    }
    index += 1;
  }
  return undefined;
}

/**
 * Read a `(...)` group starting at its `(` and return the index just past its
 * `)`, or `undefined` when it never closes. Groups nest, so the depth is
 * counted — but a class inside one is skipped whole, since a `)` written there
 * is a member rather than a closer.
 */
function skipRegexGroup(body: string, start: number): number | undefined {
  let depth = 0;
  let index = start;
  while (index < body.length) {
    const character = body.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[") {
      const next = skipRegexClass(body, index);
      if (next === undefined) {
        return undefined;
      }
      index = next;
      continue;
    }
    if (character === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return index;
      }
      continue;
    }
    index += 1;
  }
  return undefined;
}

/**
 * Read a `{2,3}` quantifier starting at its `{`, or `undefined` when what
 * follows is not one. The shape is checked rather than scanned to the next `}`,
 * because a `{` that spells no repetition is a literal to the regex engine —
 * `{a|b}` is an alternation in braces, and reading it as a quantifier would skip
 * past the `|` that has to widen the whole pattern.
 */
const QUANTIFIER = /\{\d+(,\d*)?\}/y;

function skipQuantifier(body: string, start: number): number | undefined {
  // Sticky rather than anchored against a slice: the scan asks this at every
  // `{` in the pattern, and copying the rest of the body each time would make
  // reading one pattern quadratic in its length.
  QUANTIFIER.lastIndex = start;
  const match = QUANTIFIER.exec(body);
  return match === null ? undefined : QUANTIFIER.lastIndex;
}

/**
 * Read the bracketed construct that opens at `start`, whichever kind it is, and
 * return the index just past it — or `undefined` when it never closes.
 */
function skipBracketedConstruct(body: string, start: number, open: string): number | undefined {
  if (open === "[") {
    return skipRegexClass(body, start);
  }
  if (open === "(") {
    return skipRegexGroup(body, start);
  }
  return skipQuantifier(body, start);
}

/**
 * Read the tail of a `\\x` / `\\u` escape — the hex run of `\\x20`, or the
 * braced `\\x{263A}` form — and return the index just past it. Such an escape
 * spells one character across several, so consuming only its introducer would
 * leave the hex digits behind as literal atoms and *narrow* the glob, the one
 * direction the rewrite must never take. Over-consuming only widens, so an
 * unterminated brace swallows the rest of the pattern.
 */
function skipHexEscapeTail(body: string, start: number): number {
  if (body.charAt(start) === "{") {
    const closing = body.indexOf("}", start);
    return closing === -1 ? body.length : closing + 1;
  }
  let index = start;
  while (index < body.length && /^[0-9A-Fa-f]$/.test(body.charAt(index))) {
    index += 1;
  }
  return index;
}

/**
 * Read the tail of a `\\p` / `\\P` Unicode-class escape — the braced `\\p{Greek}`
 * form, or the one-letter `\\pL` shorthand — and return the index just past it.
 * Like a hex escape, it spells its class across more than one character, so
 * leaving the shorthand letter behind would narrow the glob.
 */
function skipUnicodeClassTail(body: string, start: number): number {
  if (body.charAt(start) === "{") {
    const closing = body.indexOf("}", start);
    return closing === -1 ? body.length : closing + 1;
  }
  return Math.min(start + 1, body.length);
}

/**
 * Read the escape that opens at `start` — the `\\` and whatever it spells — and
 * say where it ends and which atom it stands for.
 */
function readEscape(body: string, start: number): { next: number; atom: string } {
  // `charAt` past the end is the empty string, so a trailing backslash widens
  // like any other escape it cannot spell.
  const escaped = body.charAt(start + 1);
  // Rust's regex crate — which Warp matches with — spells a code point as
  // `\\x41`, `\\u0041` or `\\U00000041`, braced or not.
  if (escaped === "x" || escaped === "u" || escaped === "U") {
    return { next: skipHexEscapeTail(body, start + 2), atom: "*" };
  }
  if (escaped === "p" || escaped === "P") {
    return { next: skipUnicodeClassTail(body, start + 2), atom: "*" };
  }
  return { next: start + 2, atom: escapedCharacterWidens(escaped) ? "*" : escaped };
}

/**
 * Whether an escaped character has to widen to `*` rather than stand for
 * itself: a letter or a digit spells a class (`\s`, `\d`, `\w`), a glob
 * metacharacter would be read as a wildcard or a class by the comparison
 * instead of as the literal the escape asked for, and an empty string is a
 * trailing backslash spelling nothing at all.
 */
function escapedCharacterWidens(escaped: string): boolean {
  return escaped === "" || /^[A-Za-z0-9*?[\]]$/.test(escaped);
}

/**
 * Read one `[...]`, `(...)` or `{...}` construct starting at `start`, saying
 * where it ends and whether it repeats the atom in front of it (a quantifier)
 * or is an atom of its own (a class or a group) — or that the whole pattern has
 * to widen, which is the only safe reading of a construct that never closes and
 * of one that sets flags for everything after it.
 */
function readBracketedConstruct(
  body: string,
  start: number,
  open: string,
): { next: number; widensLastAtom: boolean } | "widens-pattern" {
  const next = skipBracketedConstruct(body, start, open);
  if (next === undefined) {
    return "widens-pattern";
  }
  // `(?i)` and its kin set flags for everything that follows rather than
  // matching anything themselves, and a case-insensitive rest-of-pattern covers
  // spellings the glob written here does not. Widening only the group would
  // narrow the reading, so the whole pattern widens.
  if (open === "(" && INLINE_FLAG_GROUP_PATTERN.test(body.slice(start, next))) {
    return "widens-pattern";
  }
  return { next, widensLastAtom: open === "{" };
}

/**
 * A group that only sets flags — `(?i)`, `(?im)`, `(?-i)` — as opposed to one
 * that scopes them to its own body (`(?i:...)`, which widens to `*` like any
 * other group).
 */
const INLINE_FLAG_GROUP_PATTERN = /^\(\?[A-Za-z]*-?[A-Za-z]*\)$/;

/**
 * Approximate a Warp command pattern as a glob, so restrictions and allow rules
 * can be compared by `createShadowingRestrictionsTest`.
 *
 * Warp matches commands with regular expressions, and a glob reader would
 * misread the ordinary spellings: `.*` — Warp's catch-all — is a literal dot
 * followed by a wildcard, `[rf]` is a character class in one language and plain
 * text in the other, and an unanchored regex covers every command that merely
 * contains it. The rewrite therefore only ever widens what a pattern covers, so
 * an inexact reading withholds an allow rather than writing one the config
 * restricts.
 *
 * Widening means a construct is replaced whole rather than character by
 * character, because the characters inside it are not literals of the command:
 * a class (`[rf]`), a group (`(sudo )?`), a character escape (`\s`) and a
 * missing `^`/`$` anchor all become `*`, and a quantifier (`?`, `*`, `+`,
 * `{2}`) widens the atom in front of it — `git commits?` covers `git commit`,
 * so its glob has to as well. Both sides of a comparison are widened, so a
 * pattern that is really a glob still compares sensibly.
 *
 * A pattern the walk cannot read as one sequence widens to `*` whole: a
 * top-level `|` is two patterns rather than one, and a class, group or
 * quantifier that never closes leaves the rest of the pattern unreadable —
 * guessing at either could only narrow the result, which is the one direction
 * this rewrite must never take. An alternation *inside* a group needs no such
 * treatment: the group it sits in already widens to `*`.
 */
function warpCommandPatternToGlob(pattern: string): string {
  const anchoredStart = pattern.startsWith("^");
  const anchoredEnd = pattern.endsWith("$") && !pattern.endsWith("\\$");
  const body = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);

  // One entry per regex atom, so a quantifier can reach back and widen the atom
  // it repeats instead of leaving it behind as a required literal.
  const atoms: string[] = [];
  const widenLastAtom = (): void => {
    if (atoms.length === 0) {
      atoms.push("*");
      return;
    }
    atoms[atoms.length - 1] = "*";
  };

  let index = 0;
  while (index < body.length) {
    const character = body.charAt(index);
    if (character === "|") {
      return "*";
    }
    if (character === "\\") {
      const escape = readEscape(body, index);
      index = escape.next;
      atoms.push(escape.atom);
      continue;
    }
    if (character === "[" || character === "(" || character === "{") {
      const read = readBracketedConstruct(body, index, character);
      if (read === "widens-pattern") {
        return "*";
      }
      index = read.next;
      if (read.widensLastAtom) {
        widenLastAtom();
      } else {
        atoms.push("*");
      }
      continue;
    }
    if (character === "*" || character === "+" || character === "?") {
      index += 1;
      widenLastAtom();
      continue;
    }
    index += 1;
    atoms.push(character === "." || ")]}^$".includes(character) ? "*" : character);
  }

  const glob = atoms.join("");
  return `${anchoredStart ? "" : "*"}${glob}${anchoredEnd ? "" : "*"}`;
}

/**
 * Convert rulesync permissions config to Warp command allow/deny regex lists.
 * The `bash` category maps to both lists. The all-tools `*` category's
 * restricting rules are read too — a rule written there covers shell commands
 * as well, and ignoring it would auto-approve a command the file blocks — but
 * they only *withhold* the allow rules they cover: Warp's denylist is a regex
 * list that replaces the tool's built-in default one, so writing a pattern
 * there that may not even name a command would cost more protection than it
 * adds. Other categories are dropped (with a warning when they carry `deny`
 * rules).
 */
function convertRulesyncToWarpPermissions({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): { allow: string[]; deny: string[] } {
  const { rules, foreignRestrictingCategories, ignoredAllToolsAllowPatterns } =
    collectShellCommandRules(config.permission);
  // Warp's denylist is a regex list that replaces the tool's built-in default
  // one, so an all-tools `*` pattern — which may not even name a command —
  // withholds the allow rules it covers instead of being written there.
  const { allow, deny, shadowedAllowPatterns, unwrittenDenyPatterns, intersectionBudgetExhausted } =
    partitionCommandRules({
      rules,
      writesAllToolsDeny: false,
      normalizePattern: warpCommandPatternToGlob,
    });
  warnAboutUnwrittenCommandRules({
    toolLabel: "Warp",
    surfaceLabel: "agent_mode_command_execution_allowlist/denylist",
    foreignRestrictingCategories,
    shadowedAllowPatterns,
    unwrittenDenyPatterns,
    unwrittenDenyReason:
      "Writing any denylist replaces Warp's built-in default one, and a pattern written " +
      "under '*' need not be a command at all.",
    ignoredAllToolsAllowPatterns,
    intersectionBudgetExhausted,
    logger,
  });

  return { allow, deny };
}

/**
 * Convert Warp command allow/deny regex lists back to rulesync config under the
 * `bash` category.
 */
function convertWarpToRulesyncPermissions(params: {
  allow: string[];
  deny: string[];
}): PermissionsConfig {
  const bash: Record<string, PermissionAction> = {};
  for (const pattern of params.allow) {
    bash[pattern] = "allow";
  }
  for (const pattern of params.deny) {
    // Denylist wins over the allowlist in Warp, so a pattern in both resolves
    // to deny.
    bash[pattern] = "deny";
  }

  return Object.keys(bash).length > 0 ? { permission: { bash } } : { permission: {} };
}
