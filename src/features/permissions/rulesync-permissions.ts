import { join } from "node:path";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_PERMISSIONS_LEGACY_FILE_NAME,
  RULESYNC_PERMISSIONS_LEGACY_RELATIVE_FILE_PATH,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  isBlankPermissionPattern,
  type PermissionsConfig,
  RulesyncPermissionsFileSchema,
} from "../../types/permissions.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseJsonc, parseJsoncReportingDroppedKeys } from "../../utils/jsonc.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
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
 * Strip every blank permission pattern from an already-parsed canonical
 * document, reporting how many were dropped from each block.
 *
 * Both the shared `permission` block and every tool-scoped
 * `{toolname}.permission` block are walked, because import produces both:
 * OpenCode and Kilo route their tool-only categories into the tool-scoped block
 * verbatim, so a blank pattern in the user's own config lands there. A category
 * whose value is not a rules map is left exactly as it is, which is what keeps
 * the tool-native shapes intact — OpenCode's and Kilo's bare action strings
 * (`"external_directory": "deny"`) have no pattern key to inspect, Vibe's
 * `sensitive_patterns` objects carry no blank key, and Kilo's `sandbox` is not a
 * `permission` block at all.
 */
function stripBlankPermissionPatterns(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  removed: Map<string, number>;
} {
  const removed = new Map<string, number>();

  const filterBlock = ({
    block,
    blockPath,
  }: {
    block: Record<string, unknown>;
    blockPath: string;
  }): Record<string, unknown> => {
    const filtered: Record<string, unknown> = {};
    for (const [category, rules] of Object.entries(block)) {
      if (!isRecord(rules)) {
        filtered[category] = rules;
        continue;
      }
      const kept: Record<string, unknown> = {};
      for (const [pattern, action] of Object.entries(rules)) {
        if (isBlankPermissionPattern(pattern)) {
          const path = `${blockPath}.${category}`;
          removed.set(path, (removed.get(path) ?? 0) + 1);
          continue;
        }
        kept[pattern] = action;
      }
      // A category emptied by the filter is dropped rather than kept as `{}`.
      // An empty category reads as "rulesync manages this category and it has
      // no rules", so generate would delete the entries the tool's own config
      // already had. In a tool-scoped block this does trade one reading for
      // another — an absent category inherits the shared block instead of
      // overriding it with nothing — but the alternative destroys rules the
      // user wrote by hand, so it is the one taken here. A category that
      // arrived empty stays, since nothing here changed it.
      if (Object.keys(kept).length === 0 && Object.keys(rules).length > 0) {
        continue;
      }
      filtered[category] = kept;
    }
    return filtered;
  };

  const next: Record<string, unknown> = { ...config };
  if (isRecord(config.permission)) {
    next.permission = filterBlock({ block: config.permission, blockPath: "permission" });
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === "permission" || !isRecord(value) || !isRecord(value.permission)) {
      continue;
    }
    next[key] = {
      ...value,
      permission: filterBlock({ block: value.permission, blockPath: `${key}.permission` }),
    };
  }

  return { config: next, removed };
}

/**
 * Report the dropped patterns.
 *
 * Dropping an entry silently is the failure mode a permissions source must not
 * have. A blanket blank pattern can read as "deny everything by default";
 * removing it while keeping the narrower entries beside it leaves an import that
 * grants more than the configuration it came from. The value was not portable
 * either way, but the user has to be told it is gone.
 *
 * `logger` is optional because the import direction (`toRulesyncPermissions`)
 * takes no logger parameter; the shared `fallbackLogger` is configured from the
 * CLI flags and the resolved config, so `silent` is still honored.
 */
function warnAboutDroppedPatterns({
  removed,
  logger,
}: {
  removed: Map<string, number>;
  logger?: Logger;
}): void {
  const summary = [...removed.entries()].map(([path, count]) => `${count} in "${path}"`).join(", ");
  warnWithFallback(
    logger,
    `Dropped blank permission patterns while reading a tool's permission configuration (${summary}). An empty or whitespace-only pattern matches everything, and tools disagree on what it means — some apply it to every command, others ignore it entirely — so it is not carried into the rulesync permissions config. If one of them was a blanket deny, the imported configuration now allows more than the file it came from; re-add it with a real pattern.`,
  );
}

/**
 * Drop blank permission patterns from a canonical document produced by import.
 *
 * The canonical schema rejects a blank pattern outright, and every tool that
 * has one in its own config already treats it as something other than a real
 * pattern (Roo Code, for instance, keeps only entries passing
 * `cmd.trim().length > 0`). Reproducing one in `.rulesync/permissions.jsonc`
 * would therefore write a source file that the very next `generate` refuses —
 * so it is removed here instead, and reported.
 */
export function withoutBlankPermissionPatterns({
  fileContent,
  logger,
}: {
  fileContent: string;
  logger?: Logger;
}): string {
  const parsed: unknown = parseJsonc(fileContent);
  if (!isRecord(parsed)) {
    return fileContent;
  }

  const { config, removed } = stripBlankPermissionPatterns(parsed);
  if (removed.size === 0) {
    return fileContent;
  }
  warnAboutDroppedPatterns({ removed, logger });
  return JSON.stringify(config, null, 2);
}

/**
 * The same filter over an already-parsed document, for callers that validate a
 * canonical block before it is ever serialized. Hermes Agent stores its
 * rulesync provenance inside its own config and parses it back on import; left
 * unfiltered, one blank pattern would fail `safeParse` and discard the entire
 * provenance block without a word.
 */
export function withoutBlankPermissionPatternsIn({
  config,
  logger,
}: {
  config: Record<string, unknown>;
  logger?: Logger;
}): Record<string, unknown> {
  const { config: filtered, removed } = stripBlankPermissionPatterns(config);
  if (removed.size === 0) {
    return config;
  }
  warnAboutDroppedPatterns({ removed, logger });
  return filtered;
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
