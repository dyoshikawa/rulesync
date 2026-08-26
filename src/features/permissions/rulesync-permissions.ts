import { join } from "node:path";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_PERMISSIONS_LEGACY_FILE_NAME,
  RULESYNC_PERMISSIONS_LEGACY_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { type PermissionsConfig, RulesyncPermissionsFileSchema } from "../../types/permissions.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseJsonc, parseJsoncReportingDroppedKeys } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import {
  getRulesyncSourceCandidates,
  type RulesyncSourceSettablePaths,
} from "../../utils/rulesync-source-path.js";
import { isRecord } from "../../utils/type-guards.js";

export type RulesyncPermissionsParams = RulesyncFileParams;

export type RulesyncPermissionsFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "validate" | "relativeDirPath"
>;

export type RulesyncPermissionsSettablePaths = RulesyncSourceSettablePaths;

export class RulesyncPermissions extends RulesyncFile {
  private readonly json: PermissionsConfig;
  /**
   * Prototype-pollution keys the parser removed. They are dropped before the
   * schema ever sees them, so without this record a pattern such as
   * `"__proto__": "deny"` would produce neither an error nor an entry in any
   * generated file — the one failure mode a permissions source must not have.
   */
  private readonly droppedKeys: readonly string[];

  constructor(params: RulesyncPermissionsParams) {
    super({ ...params });

    // Sources may be authored as JSONC (`permissions.jsonc`); plain JSON is
    // valid JSONC, so both variants parse through the same strict parser.
    const { value, droppedKeys } = parseJsoncReportingDroppedKeys({
      content: this.fileContent,
    });
    this.json = value as PermissionsConfig;
    this.droppedKeys = droppedKeys;
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncPermissionsSettablePaths {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      },
      legacy: [
        {
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_PERMISSIONS_LEGACY_FILE_NAME,
        },
      ],
    };
  }

  validate(): ValidationResult {
    if (this.droppedKeys.length > 0) {
      return {
        success: false,
        error: new Error(
          `${join(this.relativeDirPath, this.relativeFilePath)} uses ${this.droppedKeys.join(", ")} as ${this.droppedKeys.length === 1 ? "a key" : "keys"}. ` +
            `Rulesync removes __proto__, constructor and prototype from every source document it parses, because assigning them would reach the prototype chain instead of the object. ` +
            `They are therefore never written to any tool's config — rename them rather than leaving entries that silently do nothing.`,
        ),
      };
    }
    const result = RulesyncPermissionsFileSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    validate = true,
  }: RulesyncPermissionsFromFileParams): Promise<RulesyncPermissions> {
    const paths = RulesyncPermissions.getSettablePaths();
    // `relativeDirPath` overrides the class-level default (`.rulesync/`) for
    // both recommended and legacy candidates so a caller loading from
    // e.g. `.rulesync.local/` finds files in that tree instead. See the
    // `inputRoots` design note.
    const overrideDirPath = relativeDirPath;

    // The .jsonc variant takes precedence when both files exist.
    for (const candidate of getRulesyncSourceCandidates({ paths })) {
      const candidateDirPath = overrideDirPath ?? candidate.relativeDirPath;
      const filePath = join(outputRoot, candidateDirPath, candidate.relativeFilePath);

      if (!(await fileExists(filePath))) {
        continue;
      }

      const fileContent = await readFileContent(filePath);

      return new RulesyncPermissions({
        outputRoot,
        relativeDirPath: candidateDirPath,
        relativeFilePath: candidate.relativeFilePath,
        fileContent,
        validate,
      });
    }

    throw new Error(
      `No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} or ${RULESYNC_PERMISSIONS_LEGACY_RELATIVE_FILE_PATH} found.`,
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
   * `.rulesync/hooks.jsonc`). The consumed `permission` key is stripped from
   * the override block so verbatim-passthrough translators (e.g. the Hermes
   * deep merge or the Codex CLI top-level key whitelist) never see it.
   *
   * Returns the same instance when the target has no tool-scoped canonical
   * `permission` block, or when the target's translator natively consumes its
   * own `permission` override shape (OpenCode / Kilo / Vibe).
   */
  forTarget({
    toolTarget,
    logger,
  }: {
    toolTarget: ToolTarget;
    logger?: Logger;
  }): RulesyncPermissions {
    if (NATIVE_PERMISSION_OVERRIDE_TARGETS.has(toolTarget)) {
      return this;
    }

    const overrideKey = PERMISSION_OVERRIDE_KEY_ALIASES[toolTarget] ?? toolTarget;
    const json: Record<string, unknown> = this.json;

    // A block authored under the alias SOURCE name (e.g. "kiro-cli" instead
    // of "kiro") is not read by anything — surface that instead of silently
    // ignoring it.
    if (overrideKey !== toolTarget && isRecord(json[toolTarget])) {
      logger?.warn(
        `The "${toolTarget}" block in ${join(this.relativeDirPath, this.relativeFilePath)} is ignored. Author it under the "${overrideKey}" key instead (the ${toolTarget} target reads that block).`,
      );
    }
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
 * Drop blank permission patterns from a canonical document produced by import.
 *
 * The canonical schema rejects a blank pattern outright, and every tool that
 * has one in its own config already ignores it (Roo Code, for instance, keeps
 * only entries passing `cmd.trim().length > 0`). Reproducing one in
 * `.rulesync/permissions.jsonc` would therefore write a source file that the
 * very next `generate` refuses, over a value the tool never honored — so
 * import removes it instead.
 *
 * Only the shared `permission` block is walked. Tool-scoped
 * `{toolname}.permission` blocks are authored by hand rather than produced by
 * import, and several of them (OpenCode, Kilo, Vibe) hold tool-native shapes
 * this filter has no business reaching into.
 */
export function withoutBlankPermissionPatterns({ fileContent }: { fileContent: string }): string {
  const parsed: unknown = parseJsonc(fileContent);
  if (!isRecord(parsed) || !isRecord(parsed.permission)) {
    return fileContent;
  }

  let removed = false;
  const permission: Record<string, unknown> = {};
  for (const [category, rules] of Object.entries(parsed.permission)) {
    if (!isRecord(rules)) {
      permission[category] = rules;
      continue;
    }
    const kept = Object.fromEntries(
      Object.entries(rules).filter(([pattern]) => {
        if (pattern.trim().length > 0) {
          return true;
        }
        removed = true;
        return false;
      }),
    );
    permission[category] = kept;
  }

  if (!removed) {
    return fileContent;
  }
  return JSON.stringify({ ...parsed, permission }, null, 2);
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
