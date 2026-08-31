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
  isBlankPermissionKey,
  type PermissionsConfig,
  RulesyncPermissionsFileSchema,
} from "../../types/permissions.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { fileExistsStrict, readFileContent } from "../../utils/file.js";
import {
  droppedPollutionKeysError,
  parseJsonc,
  parseJsoncReportingDroppedKeys,
} from "../../utils/jsonc.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import {
  RulesyncSourceNotFoundError,
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

  /**
   * The canonical document an importer produces from a tool's own config.
   *
   * Every importer has to run the blank-pattern filter over what it is about to
   * write: the canonical schema rejects a blank pattern outright, so a source
   * file carrying one would be refused by the very next `generate`. Building the
   * imported document here rather than calling the filter beside each `new
   * RulesyncPermissions(...)` is what keeps the next importer from forgetting
   * it.
   *
   * `sourcePath` is the tool config being read, used only to name it if
   * something is dropped.
   */
  static fromImportedFileContent({
    outputRoot,
    fileContent,
    sourcePath,
    logger,
  }: {
    outputRoot: string;
    fileContent: string;
    sourcePath?: string;
    logger?: Logger;
  }): RulesyncPermissions {
    return new RulesyncPermissions({
      outputRoot,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: withoutBlankPermissionKeys({ fileContent, sourcePath, logger }),
    });
  }

  validate(): ValidationResult {
    if (this.droppedKeys.length > 0) {
      return {
        success: false,
        error: droppedPollutionKeysError({
          sourcePath: this.getRelativePathFromCwd(),
          droppedKeys: this.droppedKeys,
        }),
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

      if (!(await fileExistsStrict(filePath))) {
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

    throw new RulesyncSourceNotFoundError(
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
 * Tool-scoped override keys whose `permission` block maps a category to
 * something other than a pattern map. Vibe alone keeps
 * `{ sensitive_patterns: [...] }` objects there, so the keys one level down are
 * field names and the blank-pattern filter must not walk them. The category
 * names above them are still category names, and are filtered like any other.
 *
 * Typed as `ToolTarget` so a renamed target fails to compile here rather than
 * silently stopping to match, which would let the filter start deleting Vibe's
 * fields and reporting them as removed permission patterns. That only holds for
 * targets whose override key is the target name itself: a target that aliases
 * to another key (see `PERMISSION_OVERRIDE_KEY_ALIASES`) would have to be listed
 * under the alias, which this type would reject. None of them is non-pattern-map
 * today, so add that spelling only when one becomes so.
 */
const NON_PATTERN_MAP_PERMISSION_OVERRIDE_KEYS: ReadonlySet<ToolTarget> = new Set<ToolTarget>([
  "vibe",
]);

/**
 * Strip every blank key — category or pattern — from an already-parsed
 * canonical document, reporting how many were dropped from each block.
 *
 * Both the shared `permission` block and every tool-scoped
 * `{toolname}.permission` block are walked, because import produces both:
 * OpenCode and Kilo route their tool-only categories into the tool-scoped block
 * verbatim, so a blank key in the user's own config lands there. A category
 * whose value is not a rules map keeps its value exactly as it is, which is what
 * keeps the tool-native shapes intact — OpenCode's and Kilo's bare action
 * strings (`"external_directory": "deny"`) have no pattern key to inspect, and
 * Kilo's `sandbox` is not a `permission` block at all.
 *
 * Categories are filtered for the same reason patterns are, one level up: the
 * canonical schema rejects a blank category, so reproducing one would write a
 * source file the very next `generate` refuses — and it would refuse the whole
 * file, taking every tool's permissions generation down with it.
 *
 * The patterns inside {@link NON_PATTERN_MAP_PERMISSION_OVERRIDE_KEYS} blocks
 * are left alone: they are field names rather than patterns there. Their
 * category names are still filtered.
 */
function stripBlankPermissionKeys(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  removed: DroppedBlankKeys;
} {
  const patterns = new Map<string, number>();
  const categories = new Map<string, number>();

  const filterBlock = ({
    block,
    blockPath,
    filterPatterns,
  }: {
    block: Record<string, unknown>;
    blockPath: string;
    filterPatterns: boolean;
  }): Record<string, unknown> => {
    const filtered: Record<string, unknown> = {};
    for (const [category, rules] of Object.entries(block)) {
      if (isBlankPermissionKey(category)) {
        categories.set(blockPath, (categories.get(blockPath) ?? 0) + 1);
        continue;
      }
      if (!filterPatterns || !isRecord(rules)) {
        filtered[category] = rules;
        continue;
      }
      const kept: Record<string, unknown> = {};
      for (const [pattern, action] of Object.entries(rules)) {
        if (isBlankPermissionKey(pattern)) {
          const path = `${blockPath}.${category}`;
          patterns.set(path, (patterns.get(path) ?? 0) + 1);
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
    next.permission = filterBlock({
      block: config.permission,
      blockPath: "permission",
      filterPatterns: true,
    });
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === "permission" || !isRecord(value) || !isRecord(value.permission)) {
      continue;
    }
    const permission = filterBlock({
      block: value.permission,
      blockPath: `${key}.permission`,
      filterPatterns: !NON_PATTERN_MAP_PERMISSION_OVERRIDE_KEYS.has(key as ToolTarget),
    });
    // A tool-scoped block the filter emptied loses its `permission` key rather
    // than keeping `"permission": {}`. Generation already ignores an empty
    // override, so the residue only misleads whoever opens the file next; and
    // if nothing else was authored under the tool key, the key goes too.
    const emptiedByFilter =
      Object.keys(permission).length === 0 && Object.keys(value.permission).length > 0;
    if (!emptiedByFilter) {
      next[key] = { ...value, permission };
      continue;
    }
    const { permission: _emptied, ...rest } = value;
    if (Object.keys(rest).length === 0) {
      delete next[key];
      continue;
    }
    next[key] = rest;
  }

  return { config: next, removed: { patterns, categories } };
}

/**
 * Blank keys the filter removed, counted per block: patterns by the
 * `permission.<category>` path they sat under, categories by the block itself.
 */
type DroppedBlankKeys = {
  patterns: Map<string, number>;
  categories: Map<string, number>;
};

const summarizeDroppedCounts = (counts: Map<string, number>): string =>
  // The paths embed category names read from the tool's own config, so they
  // are quoted and control-escaped rather than interpolated raw.
  [...counts.entries()].map(([path, count]) => `${count} in ${JSON.stringify(path)}`).join(", ");

/**
 * Report the dropped keys.
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
 *
 * `sourcePath` names the tool config the keys came out of. A single import run
 * reads many tools, and the block paths alone (`permission.bash`) are the same
 * for all of them, so without it the user is told something was dropped but not
 * from where.
 */
function warnAboutDroppedKeys({
  removed,
  sourcePath,
  logger,
}: {
  removed: DroppedBlankKeys;
  sourcePath?: string;
  logger?: Logger;
}): void {
  const source =
    sourcePath === undefined ? "a tool's permission configuration" : JSON.stringify(sourcePath);

  if (removed.patterns.size > 0) {
    warnWithFallback(
      logger,
      `Dropped blank permission patterns while reading ${source} (${summarizeDroppedCounts(removed.patterns)}). An empty or whitespace-only pattern matches everything, and tools disagree on what it means — some apply it to every command, others ignore it entirely — so it is not carried into the rulesync permissions config. If one of them was a blanket deny, the imported configuration now allows more than the file it came from; re-add it with a real pattern.`,
    );
  }
  if (removed.categories.size > 0) {
    warnWithFallback(
      logger,
      `Dropped blank permission categories while reading ${source} (${summarizeDroppedCounts(removed.categories)}). A category name is how every tool finds the rules underneath it, so an empty or whitespace-only one reaches no tool at all and the rules below it were never going to be generated. Carrying one into the rulesync permissions config would make the next generate refuse the whole file, so it is removed here; re-add those rules under a real category name.`,
    );
  }
}

/**
 * Drop blank permission keys from a canonical document produced by import.
 *
 * The canonical schema rejects a blank pattern and a blank category outright,
 * and every tool that has a blank pattern in its own config already treats it as
 * something other than a real pattern (Roo Code, for instance, keeps only
 * entries passing `cmd.trim().length > 0`). Reproducing either in
 * `.rulesync/permissions.jsonc` would therefore write a source file that the
 * very next `generate` refuses — the whole file, not just that entry — so they
 * are removed here instead, and reported.
 */
function withoutBlankPermissionKeys({
  fileContent,
  sourcePath,
  logger,
}: {
  fileContent: string;
  sourcePath?: string;
  logger?: Logger;
}): string {
  const parsed: unknown = parseJsonc(fileContent);
  if (!isRecord(parsed)) {
    return fileContent;
  }

  const { config, removed } = stripBlankPermissionKeys(parsed);
  if (removed.patterns.size === 0 && removed.categories.size === 0) {
    return fileContent;
  }
  warnAboutDroppedKeys({ removed, sourcePath, logger });
  return JSON.stringify(config, null, 2);
}

/**
 * The same filter over an already-parsed document, for callers that validate a
 * canonical block before it is ever serialized. Hermes Agent stores its
 * rulesync provenance inside its own config and parses it back on import; left
 * unfiltered, one blank pattern or category would fail `safeParse` and discard
 * the entire provenance block without a word.
 */
export function withoutBlankPermissionKeysIn({
  config,
  sourcePath,
  logger,
}: {
  config: Record<string, unknown>;
  sourcePath?: string;
  logger?: Logger;
}): Record<string, unknown> {
  const { config: filtered, removed } = stripBlankPermissionKeys(config);
  if (removed.patterns.size === 0 && removed.categories.size === 0) {
    return config;
  }
  warnAboutDroppedKeys({ removed, sourcePath, logger });
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
export const PERMISSION_OVERRIDE_KEY_ALIASES: Partial<Record<ToolTarget, string>> = {
  "kiro-cli": "kiro",
  "kiro-ide": "kiro",
  hermesagent: "hermes",
};
