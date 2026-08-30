import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  FACTORYDROID_DIR,
  FACTORYDROID_SETTINGS_FILE_NAME,
} from "../../constants/factorydroid-paths.js";
import { FACTORYDROID_OVERRIDE_KEYS } from "../../constants/factorydroid-settings-keys.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFactorydroidSettingsWithLocalOverlay } from "../../utils/factorydroid-settings.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
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

/**
 * Factory Droid's `settings.json` shape (only the keys this adapter manages are
 * modeled; all other keys are preserved verbatim on round-trip).
 *
 * @see https://docs.factory.ai/cli/configuration/settings
 */
type FactorydroidSettingsJson = {
  commandAllowlist?: string[];
  commandDenylist?: string[];
  commandBlocklist?: string[];
  [key: string]: unknown;
};

/**
 * Permissions adapter for Factory Droid.
 *
 * Factory Droid gates **shell command** execution through two arrays in
 * `.factory/settings.json` (project) / `~/.factory/settings.json` (global):
 * - `commandAllowlist` — commands that run without confirmation.
 * - `commandDenylist` — commands that always require confirmation (denylist
 *   wins when a command is in both).
 *
 * rulesync's canonical `permission.bash` patterns map directly: `allow` →
 * `commandAllowlist`, `deny` → `commandDenylist`. Factory Droid has no separate
 * "ask" list (any command not in the allowlist already prompts), so `ask` rules
 * write nothing — they only withhold the allow rules they cover, since the
 * stricter rule wins whatever its width. The all-tools `*` category contributes
 * its restricting rules too, because a rule written there covers shell commands
 * as well. They withhold the allow rules they cover the way a `bash` `ask`
 * does, because a pattern written under `*` need not name a command at all: a
 * `deny` there is written to `commandDenylist` too, for the case where it *is*
 * one, but an entry naming no command enforces nothing by itself.
 * The allow/deny lists only model shell commands, so categories other
 * than `bash` and `*` cannot be represented and are skipped (with a warning
 * when they carry `deny` rules, to surface the gap).
 *
 * Factory Droid also has a stronger `commandBlocklist` tier — commands that can
 * never run, not even under full autonomy — plus other security controls
 * (`networkPolicy`, `sandbox`, `mcpPolicy`, `enableDroidShield`, autonomy
 * settings) that do not fit the canonical `allow | ask | deny` per-command
 * model. These are authored and round-tripped through the `factorydroid`
 * override namespace (see `FactorydroidPermissionsOverrideSchema`): on **import**
 * they are lifted from `settings.json` into the override, and on **export** they
 * are merged back in — so `commandBlocklist`'s never-runs guarantee is preserved
 * faithfully rather than being collapsed onto an approvable `deny`.
 */
export class FactorydroidPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * `.factory/settings.json` holds other settings (hooks, autonomy, etc.), so
   * it must never be deleted by the permissions feature.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Project: `.factory/settings.json`; global: `~/.factory/settings.json`
    // (the home directory is resolved by the processor through outputRoot).
    return {
      relativeDirPath: FACTORYDROID_DIR,
      relativeFilePath: FACTORYDROID_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
    logger,
  }: ToolPermissionsFromFileParams): Promise<FactorydroidPermissions> {
    const paths = FactorydroidPermissions.getSettablePaths({ global });
    // Droid applies `settings.local.json` on top of `settings.json` at this
    // scope, so importing without it would read permissions Droid does not
    // actually enforce. Generation still writes `settings.json` alone.
    const fileContent =
      (await readFactorydroidSettingsWithLocalOverlay({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        baseFileName: paths.relativeFilePath,
        logger,
      })) ?? "{}";
    return new FactorydroidPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<FactorydroidPermissions> {
    const paths = FactorydroidPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    let settings: FactorydroidSettingsJson;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Factory Droid settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, deny } = convertRulesyncToFactorydroidPermissions({ config, logger });

    // rulesync owns the commandAllowlist/commandDenylist surface; every other
    // key in settings.json (hooks, autonomy, etc.) is preserved verbatim.
    // The `factorydroid` override authors Factory-specific security keys
    // (commandBlocklist, networkPolicy, sandbox, ...); overlay them here (the
    // override wins), before setting the managed allow/deny lists below.
    const override = config.factorydroid;
    const merged: FactorydroidSettingsJson = {
      ...settings,
      ...(override !== undefined && typeof override === "object" ? override : {}),
    };

    const mergedAllow = uniq(allow.toSorted());
    const mergedDeny = uniq(deny.toSorted());

    if (mergedAllow.length > 0) {
      merged.commandAllowlist = mergedAllow;
    } else {
      delete merged.commandAllowlist;
    }
    if (mergedDeny.length > 0) {
      merged.commandDenylist = mergedDeny;
    } else {
      delete merged.commandDenylist;
    }

    return new FactorydroidPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: FactorydroidSettingsJson;
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Factory Droid permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = convertFactorydroidToRulesyncPermissions({
      allow: Array.isArray(settings.commandAllowlist) ? settings.commandAllowlist : [],
      deny: Array.isArray(settings.commandDenylist) ? settings.commandDenylist : [],
    });

    // Route Factory Droid's security controls into the `factorydroid` override.
    // `commandBlocklist` (the hard-block tier) now round-trips faithfully here
    // rather than collapsing onto an approvable canonical `deny`.
    const factorydroidOverride: Record<string, unknown> = {};
    for (const key of FACTORYDROID_OVERRIDE_KEYS) {
      if (settings[key] !== undefined) factorydroidOverride[key] = settings[key];
    }

    const result: Record<string, unknown> = { ...config };
    if (Object.keys(factorydroidOverride).length > 0) {
      result.factorydroid = factorydroidOverride;
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
  }: ToolPermissionsForDeletionParams): FactorydroidPermissions {
    return new FactorydroidPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({}, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Factory Droid allow/deny command lists.
 * The `bash` category maps, and so do the restricting rules of the all-tools
 * `*` category — a `deny` written there covers shell commands too, and skipping
 * it would auto-approve a command the file blocks. Other categories are dropped
 * (with a warning when they carry `deny` rules).
 */
function convertRulesyncToFactorydroidPermissions({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): { allow: string[]; deny: string[] } {
  const { rules, foreignDenyCategories, ignoredAllToolsAllowPatterns } = collectShellCommandRules(
    config.permission,
  );
  // Factory Droid's denylist is an ordinary command list that adds to nothing
  // it ships with, so an all-tools `*` deny can be written there verbatim,
  // where the deny-beats-allow order enforces it for whatever commands it does
  // name. It withholds the allow rules it covers all the same: a pattern under
  // `*` such as `secrets/**` names no command, so the entry alone would leave
  // the very access the author denied auto-approved by the allowlist.
  const {
    allow,
    deny,
    shadowedAllowPatterns,
    unenforcedAllToolsDenyPatterns,
    unenforcedAskPatterns,
  } = partitionCommandRules({
    rules,
    writesAllToolsDeny: true,
  });
  warnAboutUnwrittenCommandRules({
    toolLabel: "Factory Droid",
    surfaceLabel: "commandAllowlist/commandDenylist",
    foreignDenyCategories,
    shadowedAllowPatterns,
    unenforcedAllToolsDenyPatterns,
    unenforcedAskPatterns,
    ignoredAllToolsAllowPatterns,
    logger,
  });

  return { allow, deny };
}

/**
 * Convert Factory Droid allow/deny command lists back to rulesync config under
 * the `bash` category.
 *
 * `commandBlocklist` (the hard-block tier) is no longer collapsed here — it has
 * no canonical equivalent and now round-trips through the `factorydroid`
 * override so the never-runs guarantee is preserved instead of being weakened to
 * an approvable `deny`.
 */
function convertFactorydroidToRulesyncPermissions({
  allow,
  deny,
}: {
  allow: string[];
  deny: string[];
}): PermissionsConfig {
  const bash: Record<string, PermissionAction> = {};

  for (const pattern of allow) {
    bash[pattern] = "allow";
  }
  // Denylist wins when a command appears in both lists.
  for (const pattern of deny) {
    bash[pattern] = "deny";
  }

  const permission: Record<string, Record<string, PermissionAction>> = Object.keys(bash).length > 0
    ? { bash }
    : {};

  return { permission };
}
