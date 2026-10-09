import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import { WARP_PERMISSIONS_FILE_NAME, warpcliConfigDir } from "../../constants/warp-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";
import {
  convertRulesyncToWarpPermissions,
  convertWarpToRulesyncPermissions,
  DEFAULT_PROFILE_KEY,
  EXECUTION_PROFILES_KEY,
  liftExecutionProfileOverride,
  mergeDefaultExecutionProfile,
  PROFILE_ALLOWLIST_KEY,
  PROFILE_DENYLIST_KEY,
  applyAutoApproveBypassOverride,
  readAutoApproveBypass,
  WARP_AUTO_APPROVE_BYPASS_KEY,
  WARP_EXECUTION_PROFILE_OVERRIDE_KEY,
  warnAboutDenylistReplacement,
} from "./warp-permissions.js";

const WARPCLI_GLOBAL_ONLY_MESSAGE =
  "Warp Agent CLI permissions are global-only; use --global to sync the CLI's settings.toml";

/**
 * Permissions adapter for the standalone Warp Agent CLI (the `warp` binary).
 *
 * The CLI keeps its own `settings.toml`, separate from the Warp app's ("the app
 * and the CLI keep separate settings files"), and "reads its permissions from
 * execution profiles stored in its settings file ... the CLI always runs with
 * the profile under the reserved `default` key". So rulesync writes only the
 * `[agents.execution_profiles.default]` record:
 * - `command_allowlist` / `command_denylist` from the canonical `bash` (and
 *   restricting `*`) rules, converted exactly as for the `warp` target —
 *   including the warning that writing a denylist replaces the built-in one.
 * - The `warpcli.execution_profile` override's autonomy keys
 *   (`read_files`, `apply_code_diffs`, `run_agents`, ...), merged first so the
 *   rulesync-owned command lists always win.
 *
 * The `warpcli.auto_approve_bypasses_command_denylist` override is written to
 * the sibling `[agents.warp_agent.other]` table.
 *
 * Unlike the `warp` target, the CLI never read the app's legacy
 * `[agents.profiles]` keys, so none are written, and there is no settings
 * migration to wait for: the CLI's settings file "is created the first time you
 * change a setting", so the `default` record is created directly when absent.
 * Every other key of the file and of the `default` record is preserved, and the
 * file is never deleted. Like the app's surface, it is **global only**.
 *
 * @see https://docs.warp.dev/agents/cli/configuration/
 * @see https://docs.warp.dev/agents/cli/permissions-and-profiles/
 */
export class WarpcliPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  /**
   * The CLI's `settings.toml` holds every CLI setting, so rulesync merges into
   * it but never creates one just to hold an empty `default` profile.
   */
  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return true;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: warpcliConfigDir(),
      relativeFilePath: WARP_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<WarpcliPermissions> {
    if (!global) {
      throw new Error(WARPCLI_GLOBAL_ONLY_MESSAGE);
    }
    const paths = WarpcliPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new WarpcliPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<WarpcliPermissions> {
    if (!global) {
      throw new Error(WARPCLI_GLOBAL_ONLY_MESSAGE);
    }
    const paths = WarpcliPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // settings.toml as a side effect.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let settings: Record<string, unknown>;
    try {
      settings = smolToml.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Warp Agent CLI settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, deny } = convertRulesyncToWarpPermissions({
      config,
      logger,
      toolLabel: "Warp Agent CLI",
      surfaceLabel: "command_allowlist/command_denylist",
    });
    const mergedAllow = uniq(allow.toSorted());
    const mergedDeny = uniq(deny.toSorted());

    const override = config.warpcli;
    const executionProfileOverride =
      isRecord(override) && isRecord(override[WARP_EXECUTION_PROFILE_OVERRIDE_KEY])
        ? override[WARP_EXECUTION_PROFILE_OVERRIDE_KEY]
        : undefined;

    // Unlike the app, the CLI has no settings migration to wait for, so the
    // collection is created when absent.
    const agents = isRecord(settings.agents) ? { ...settings.agents } : {};
    agents[EXECUTION_PROFILES_KEY] = mergeDefaultExecutionProfile({
      executionProfiles: isRecord(agents[EXECUTION_PROFILES_KEY])
        ? agents[EXECUTION_PROFILES_KEY]
        : {},
      mergedAllow,
      mergedDeny,
      executionProfileOverride,
    });
    applyAutoApproveBypassOverride({ agents, override });
    settings.agents = agents;

    warnAboutDenylistReplacement({
      toolLabel: "Warp Agent CLI",
      overrideKey: "warpcli",
      denyCount: mergedDeny.length,
      autoApproveBypassesDenylist: readAutoApproveBypass(agents),
      logger,
    });

    return new WarpcliPermissions({
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
        `Failed to parse Warp Agent CLI permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    // Only the `default` profile is ever enforced by the CLI.
    const agents = isRecord(settings.agents) ? settings.agents : {};
    const executionProfiles = isRecord(agents[EXECUTION_PROFILES_KEY])
      ? agents[EXECUTION_PROFILES_KEY]
      : {};
    const defaultProfile = isRecord(executionProfiles[DEFAULT_PROFILE_KEY])
      ? executionProfiles[DEFAULT_PROFILE_KEY]
      : {};

    const allowlist = defaultProfile[PROFILE_ALLOWLIST_KEY];
    const denylist = defaultProfile[PROFILE_DENYLIST_KEY];
    const config = convertWarpToRulesyncPermissions({
      allow: isStringArray(allowlist) ? allowlist : [],
      deny: isStringArray(denylist) ? denylist : [],
    });

    // Lift the `default` profile's autonomy keys into the `warpcli` override so
    // they round-trip.
    const executionProfileOverride = liftExecutionProfileOverride(defaultProfile);

    // `auto_approve_bypasses_command_denylist` lives in the sibling
    // `[agents.warp_agent.other]` table, so it is lifted separately.
    const warpcliOverride: Record<string, unknown> = {};
    if (executionProfileOverride) {
      warpcliOverride[WARP_EXECUTION_PROFILE_OVERRIDE_KEY] = executionProfileOverride;
    }
    const autoApproveBypass = readAutoApproveBypass(agents);
    if (autoApproveBypass !== undefined) {
      warpcliOverride[WARP_AUTO_APPROVE_BYPASS_KEY] = autoApproveBypass;
    }

    const result: Record<string, unknown> = { ...config };
    if (Object.keys(warpcliOverride).length > 0) {
      result.warpcli = warpcliOverride;
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
  }: ToolPermissionsForDeletionParams): WarpcliPermissions {
    return new WarpcliPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global: true,
    });
  }
}
