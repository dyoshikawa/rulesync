import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  FACTORYDROID_DIR,
  FACTORYDROID_SETTINGS_FILE_NAME,
} from "../../constants/factorydroid-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
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
 * "ask" list (any command not in the allowlist already prompts), so `ask`
 * rules are intentionally dropped. The allow/deny lists only model shell
 * commands, so categories other than `bash` cannot be represented and are
 * skipped (with a warning when they carry `deny` rules, to surface the gap).
 *
 * Factory Droid also has a stronger `commandBlocklist` tier — commands that can
 * never run, not even under full autonomy. rulesync's canonical action model
 * has only `allow | ask | deny`, with no equivalent of a hard block that can
 * never be approved. So on **import** a `commandBlocklist` entry is collapsed
 * onto canonical `deny` (lossy: the never-runs guarantee is weakened to a deny
 * the user can still approve), rather than being silently dropped. On **export**
 * there is no canonical `block` to emit one from, so rulesync never writes
 * `commandBlocklist`; an existing one on disk is preserved verbatim as an
 * unmanaged key.
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
  }: ToolPermissionsFromFileParams): Promise<FactorydroidPermissions> {
    const paths = FactorydroidPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
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
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );

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
    const merged: FactorydroidSettingsJson = { ...settings };

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
      block: Array.isArray(settings.commandBlocklist) ? settings.commandBlocklist : [],
    });

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
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
 * Only the `bash` category maps; `ask` rules and non-`bash` categories are
 * dropped (the latter with a warning when they carry `deny` rules).
 */
function convertRulesyncToFactorydroidPermissions({
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
          `Factory Droid only models shell-command permissions (commandAllowlist/commandDenylist); ` +
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
          // Factory Droid prompts by default for any command not in the
          // allowlist, so there is no separate "ask" list to populate.
          break;
      }
    }
  }

  return { allow, deny };
}

/**
 * Convert Factory Droid allow/deny/block command lists back to rulesync config
 * under the `bash` category.
 *
 * `commandBlocklist` (hard block) has no canonical equivalent, so it collapses
 * onto `deny` — lossy (a deny can still be approved), but preferable to dropping
 * the rule entirely.
 */
function convertFactorydroidToRulesyncPermissions({
  allow,
  deny,
  block,
}: {
  allow: string[];
  deny: string[];
  block: string[];
}): PermissionsConfig {
  const bash: Record<string, PermissionAction> = {};

  for (const pattern of allow) {
    bash[pattern] = "allow";
  }
  // Denylist wins when a command appears in both lists.
  for (const pattern of deny) {
    bash[pattern] = "deny";
  }
  // A hard-block command outranks everything, so apply it last; it collapses
  // onto `deny` since the canonical model has no hard-block action.
  for (const pattern of block) {
    bash[pattern] = "deny";
  }

  const permission: Record<string, Record<string, PermissionAction>> = Object.keys(bash).length > 0
    ? { bash }
    : {};

  return { permission };
}
