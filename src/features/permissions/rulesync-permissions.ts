import { join } from "node:path";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_PERMISSIONS_JSONC_FILE_NAME,
  RULESYNC_PERMISSIONS_JSONC_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { type PermissionsConfig, RulesyncPermissionsFileSchema } from "../../types/permissions.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import { isRecord } from "../../utils/type-guards.js";

export type RulesyncPermissionsParams = RulesyncFileParams;

export type RulesyncPermissionsFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "validate"
>;

export type RulesyncPermissionsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
  jsonc: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export class RulesyncPermissions extends RulesyncFile {
  private readonly json: PermissionsConfig;

  constructor(params: RulesyncPermissionsParams) {
    super({ ...params });

    // Sources may be authored as JSONC (`permissions.jsonc`); plain JSON is
    // valid JSONC, so both variants parse through the same strict parser.
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
      jsonc: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_JSONC_FILE_NAME,
      },
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
    // The .jsonc variant takes precedence when both files exist.
    const candidates = [
      paths.jsonc,
      { relativeDirPath: paths.relativeDirPath, relativeFilePath: paths.relativeFilePath },
    ];

    for (const candidate of candidates) {
      const filePath = join(outputRoot, candidate.relativeDirPath, candidate.relativeFilePath);
      if (!(await fileExists(filePath))) {
        continue;
      }
      const fileContent = await readFileContent(filePath);
      return new RulesyncPermissions({
        outputRoot,
        relativeDirPath: candidate.relativeDirPath,
        relativeFilePath: candidate.relativeFilePath,
        fileContent,
        validate,
      });
    }

    throw new Error(
      `No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} or ${RULESYNC_PERMISSIONS_JSONC_RELATIVE_FILE_PATH} found.`,
    );
  }

  getJson(): PermissionsConfig {
    return this.json;
  }

  /**
   * Build the effective permissions config for one tool target by merging the
   * tool-scoped `{toolname}.permission` block over the shared `permission`
   * block, per category (the tool-scoped category replaces the shared one
   * wholesale — mirroring how `{toolname}.hooks` merges per event in
   * `.rulesync/hooks.json`). The consumed `permission` key is stripped from
   * the override block so verbatim-passthrough translators (e.g. the Hermes
   * deep merge or the Codex CLI top-level key whitelist) never see it.
   *
   * Returns the same instance when the target has no tool-scoped canonical
   * `permission` block, or when the target's translator natively consumes its
   * own `permission` override shape (OpenCode / Kilo / Vibe).
   */
  forTarget({ toolTarget }: { toolTarget: ToolTarget }): RulesyncPermissions {
    if (NATIVE_PERMISSION_OVERRIDE_TARGETS.has(toolTarget)) {
      return this;
    }

    const overrideKey = PERMISSION_OVERRIDE_KEY_ALIASES[toolTarget] ?? toolTarget;
    const json: Record<string, unknown> = this.json;
    const overrideBlock = json[overrideKey];
    if (!isRecord(overrideBlock) || !isRecord(overrideBlock.permission)) {
      return this;
    }

    const { permission: toolScopedPermission, ...restOverride } = overrideBlock;
    const merged: Record<string, unknown> = {
      ...json,
      permission: { ...this.json.permission, ...toolScopedPermission },
    };
    if (Object.keys(restOverride).length > 0) {
      merged[overrideKey] = restOverride;
    } else {
      delete merged[overrideKey];
    }

    return new RulesyncPermissions({
      outputRoot: this.outputRoot,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
    });
  }
}

/**
 * Targets whose tool-scoped `permission` override uses tool-native semantics
 * consumed directly by their translator (bare action strings / tool-only
 * categories for OpenCode and Kilo, `sensitive_patterns` objects for Vibe).
 * The central canonical merge must not touch those blocks.
 */
const NATIVE_PERMISSION_OVERRIDE_TARGETS: ReadonlySet<ToolTarget> = new Set([
  "opencode",
  "kilo",
  "vibe",
]);

/**
 * Targets that read their tool-scoped override from a differently named key:
 * Kiro IDE/CLI share the `kiro` block (they write the same agent config) and
 * Hermes Agent's established override key is `hermes`.
 */
const PERMISSION_OVERRIDE_KEY_ALIASES: Partial<Record<ToolTarget, string>> = {
  "kiro-cli": "kiro",
  "kiro-ide": "kiro",
  hermesagent: "hermes",
};
