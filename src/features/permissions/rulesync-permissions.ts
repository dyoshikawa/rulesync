import { join } from "node:path";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_PERMISSIONS_JSONC_FILE_NAME,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  type PermissionAction,
  PermissionActionSchema,
  type PermissionsConfig,
  RulesyncPermissionsFileSchema,
} from "../../types/permissions.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";

export type RulesyncPermissionsParams = RulesyncFileParams;

export type RulesyncPermissionsFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "validate"
>;

export type RulesyncPermissionsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

/**
 * Targets that natively consume their tool-scoped `permission` override with
 * tool-specific semantics (bare-action categories, native key translation).
 * The central merge in {@link RulesyncPermissions.forTarget} must not
 * double-apply those blocks.
 */
const NATIVE_PERMISSION_OVERRIDE_TARGETS: ReadonlySet<string> = new Set(["opencode", "kilo"]);

/**
 * Tool targets that share another target's override key because they write the
 * same output file (`kiro`/`kiro-cli`/`kiro-ide` share `.kiro/agents/default.json`;
 * `hermesagent`'s override key has always been `hermes`).
 */
const PERMISSION_OVERRIDE_KEY_ALIASES: Readonly<Record<string, string>> = {
  "kiro-cli": "kiro",
  "kiro-ide": "kiro",
  hermesagent: "hermes",
};

function isPermissionAction(value: unknown): value is PermissionAction {
  return PermissionActionSchema.safeParse(value).success;
}

function isPermissionRules(value: unknown): value is Record<string, PermissionAction> {
  return isPlainObject(value) && Object.values(value).every(isPermissionAction);
}

export class RulesyncPermissions extends RulesyncFile {
  private readonly json: PermissionsConfig;

  constructor(params: RulesyncPermissionsParams) {
    super({ ...params });

    // JSONC is a superset of JSON, so both `.json` and `.jsonc` sources parse here.
    this.json = parseJsonc(this.fileContent) as PermissionsConfig;
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncPermissionsSettablePaths {
    return {
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    };
  }

  validate(): ValidationResult {
    const result = RulesyncPermissionsFileSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: RulesyncPermissionsFromFileParams): Promise<RulesyncPermissions> {
    const paths = RulesyncPermissions.getSettablePaths();

    // The `.jsonc` twin wins over `.json` when both exist.
    const jsoncFilePath = join(
      outputRoot,
      paths.relativeDirPath,
      RULESYNC_PERMISSIONS_JSONC_FILE_NAME,
    );
    if (await fileExists(jsoncFilePath)) {
      const fileContent = await readFileContent(jsoncFilePath);
      return new RulesyncPermissions({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: RULESYNC_PERMISSIONS_JSONC_FILE_NAME,
        fileContent,
        validate,
      });
    }

    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    if (!(await fileExists(filePath))) {
      throw new Error(`No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} found.`);
    }

    const fileContent = await readFileContent(filePath);
    return new RulesyncPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  getJson(): PermissionsConfig {
    return this.json;
  }

  /**
   * Resolve the generalized `{toolname}.permission` override for a tool target:
   * each canonical-shaped category value (a pattern-to-action map, or a bare
   * action string treated as `{ "*": action }`) replaces the shared category
   * wholesale, only for that target. Consumed entries are stripped from the
   * override block in the returned instance so verbatim-passthrough translators
   * (hermes deep-merge, cursor cli.json extras, codexcli's whitelisted
   * top-level keys, ...) never see them; non-canonical value shapes (e.g.
   * Vibe's `sensitive_patterns` objects) are left in place for the tool's own
   * translator. Targets that natively consume the same key (OpenCode, Kilo)
   * are returned unchanged.
   */
  forTarget({ toolTarget, logger }: { toolTarget: string; logger?: Logger }): RulesyncPermissions {
    if (NATIVE_PERMISSION_OVERRIDE_TARGETS.has(toolTarget)) {
      return this;
    }

    const overrideKey = PERMISSION_OVERRIDE_KEY_ALIASES[toolTarget] ?? toolTarget;
    const json: Record<string, unknown> = this.json;
    const overrideBlock = json[overrideKey];
    if (!isPlainObject(overrideBlock) || !isPlainObject(overrideBlock.permission)) {
      return this;
    }

    const mergedPermission: PermissionsConfig["permission"] = { ...this.json.permission };
    const remainingOverridePermission: Record<string, unknown> = {};
    for (const [category, value] of Object.entries(overrideBlock.permission)) {
      if (isPermissionAction(value)) {
        mergedPermission[category] = { "*": value };
        continue;
      }
      if (isPermissionRules(value)) {
        mergedPermission[category] = value;
        continue;
      }
      // Tool-specific value shape (e.g. Vibe's sensitive_patterns escalation);
      // leave it for the tool's own translator.
      logger?.debug(
        `Leaving non-canonical "${overrideKey}.permission.${category}" value to the ${toolTarget} translator.`,
      );
      remainingOverridePermission[category] = value;
    }

    const remainingOverrideBlock = { ...overrideBlock };
    if (Object.keys(remainingOverridePermission).length > 0) {
      remainingOverrideBlock.permission = remainingOverridePermission;
    } else {
      delete remainingOverrideBlock.permission;
    }

    const mergedJson = {
      ...this.json,
      permission: mergedPermission,
      [overrideKey]: remainingOverrideBlock,
    };

    return new RulesyncPermissions({
      outputRoot: this.outputRoot,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: JSON.stringify(mergedJson, null, 2),
      validate: false,
    });
  }
}
