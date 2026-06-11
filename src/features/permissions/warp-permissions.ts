import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
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

// Keys under the `[agents.profiles]` table that hold the command permission
// regex arrays. https://docs.warp.dev/agent-platform/capabilities/agent-profiles-permissions/
const ALLOWLIST_KEY = "agent_mode_command_execution_allowlist";
const DENYLIST_KEY = "agent_mode_command_execution_denylist";

/**
 * Warp's `settings.toml` lives in a different directory per platform (Stable
 * channel). The home directory is resolved by the processor through
 * `outputRoot`, so only the home-relative directory is returned here.
 *
 * - macOS: `~/.warp/settings.toml`
 * - Linux: `~/.config/warp-terminal/settings.toml`
 * - Windows: `%APPDATA%\warp\Warp\data\settings.toml` (`%APPDATA%` is
 *   `~/AppData/Roaming`)
 *
 * @see https://docs.warp.dev/terminal/settings/file-locations/
 */
function warpSettingsDir(): string {
  switch (process.platform) {
    case "darwin":
      return ".warp";
    case "win32":
      return join("AppData", "Roaming", "warp", "Warp", "data");
    default:
      return join(".config", "warp-terminal");
  }
}

/**
 * Permissions adapter for Warp.
 *
 * Warp gates **shell command** execution through two regex arrays under the
 * `[agents.profiles]` table of the global user `settings.toml`:
 * - `agent_mode_command_execution_allowlist` — commands that auto-execute.
 * - `agent_mode_command_execution_denylist` — commands that always require
 *   permission (the denylist wins over the allowlist).
 *
 * This surface is **global only** — there is no project-scoped Warp permissions
 * file. rulesync's canonical `permission.bash` patterns map directly (`allow` →
 * allowlist, `deny` → denylist). Warp matches commands with regular
 * expressions, so patterns are emitted verbatim — author canonical `bash`
 * patterns as regexes when targeting Warp (mirrors the Zed permissions
 * adapter). Warp has no per-command "ask" list, so `ask` rules are dropped; and
 * the command lists only model shell commands, so non-`bash` categories are
 * skipped (with a warning when they carry `deny` rules). MCP allow/deny and the
 * file-read permissions are separate surfaces not modeled here.
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
      relativeFilePath: "settings.toml",
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
    const existingContent = await readOrInitializeFileContent(filePath, "");

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

    const mergedAllow = uniq(allow.toSorted());
    const mergedDeny = uniq(deny.toSorted());
    if (mergedAllow.length > 0) profiles[ALLOWLIST_KEY] = mergedAllow;
    else delete profiles[ALLOWLIST_KEY];
    if (mergedDeny.length > 0) profiles[DENYLIST_KEY] = mergedDeny;
    else delete profiles[DENYLIST_KEY];

    agents.profiles = profiles;
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
    const allow = isStringArray(profiles[ALLOWLIST_KEY]) ? profiles[ALLOWLIST_KEY] : [];
    const deny = isStringArray(profiles[DENYLIST_KEY]) ? profiles[DENYLIST_KEY] : [];

    const config = convertWarpToRulesyncPermissions({ allow, deny });
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
