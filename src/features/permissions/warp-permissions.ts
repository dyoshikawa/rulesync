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
 *   wins over the allowlist).
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
 * adapter). Warp has no per-command "ask" list, so `ask` rules are dropped; and
 * the command lists only model shell commands, so non-`bash` categories are
 * skipped (with a warning when they carry `deny` rules).
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
 * Convert rulesync permissions config to Warp command allow/deny regex lists.
 * Only the `bash` category maps; `ask` rules and non-`bash` categories are
 * dropped (the latter with a warning when they carry `deny` rules).
 */
function convertRulesyncToWarpPermissions({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): { allow: string[]; deny: string[] } {
  const allow: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    if (category !== "bash") {
      const hasDeny = Object.values(rules).some((action) => action === "deny");
      if (hasDeny && logger) {
        logger.warn(
          `Warp only models shell-command permissions (agent_mode_command_execution_allowlist/denylist); ` +
            `'${category}' deny rules cannot be represented and were skipped.`,
        );
      }
      continue;
    }
    for (const [pattern, action] of Object.entries(rules)) {
      switch (action) {
        case "allow":
          allow.push(pattern);
          break;
        case "deny":
          deny.push(pattern);
          break;
        case "ask":
          // Warp has no per-command "ask" list (commands not in the allowlist
          // already prompt), so there is nothing to populate.
          break;
      }
    }
  }

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
