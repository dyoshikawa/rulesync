import { isAbsolute, join } from "node:path";

import { uniq } from "es-toolkit";

import {
  POOL_DIR,
  POOL_GLOBAL_DIR,
  POOL_PATHS_KEY,
  POOL_SETTINGS_FILE_NAME,
  POOL_TOOLS_KEY,
} from "../../constants/pool-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  createShadowingRestrictionsTest,
  honorAllToolsOnBash,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

// The keys of one `tools.<name>` block and of one `paths` entry.
const POOL_ALLOW_KEY = "allow";
const POOL_DENY_KEY = "deny";
const POOL_DISABLED_KEY = "disabled";
const POOL_PATH_KEY = "path";
const POOL_WRITE_KEY = "write";

// The catch-all rulesync pattern; a rule about the whole tool.
const CATCH_ALL_PATTERN = "*";

// The catch-all `paths` glob. A bare `*` names every file canonically, but a
// `*` in Pool's path globs is one path segment, so the catch-all is spelled
// `**` there; read back, `**` is the canonical catch-all as well.
const PATHS_CATCH_ALL_PATTERN = "**";

// rulesync canonical categories -> Pool's built-in tool names. Any other
// non-file category passes through verbatim, so a further Pool tool can be
// named directly.
// https://docs.poolside.ai/settings-file-reference
const CANONICAL_TO_POOL_TOOL_NAMES: Record<string, string> = {
  bash: "shell",
  webfetch: "web_fetch",
  websearch: "web_search",
};

const POOL_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_POOL_TOOL_NAMES).map(([k, v]) => [v, k]),
);

// The canonical categories that govern file access. Pool models file access
// as `paths` (read-only unless `write: true`) rather than as tool rules, so
// these three are written there: `read` grants reading, `edit` and `write`
// both grant Pool's single write permission.
const READ_CATEGORY = "read";
const WRITE_CATEGORIES = ["edit", "write"] as const;
const FILE_CATEGORIES: readonly string[] = [READ_CATEGORY, ...WRITE_CATEGORIES];

// The canonical per-tool MCP category; Pool approves MCP tools per server
// under `mcp_servers.<server>.allow`/`deny`, which the mcp feature writes.
const MCP_CANONICAL_PREFIX = "mcp__";

/**
 * Single spelling of the settings.yaml codec/policy, matching the
 * `SHARED_CONFIG_OWNERSHIP` declaration for both scopes: fail closed on an
 * unparseable root rather than replacing the user's primary Pool settings with
 * generated output.
 */
function parsePoolSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "yaml",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

// Own-property lookups only: a `constructor` category would otherwise resolve
// to the `Object` function through the prototype chain.
function toPoolToolName(canonical: string): string {
  return lookupOwn({ record: CANONICAL_TO_POOL_TOOL_NAMES, key: canonical }) ?? canonical;
}

function toCanonicalToolName(poolName: string): string {
  return lookupOwn({ record: POOL_TO_CANONICAL_TOOL_NAMES, key: poolName }) ?? poolName;
}

function isMcpCategory(category: string): boolean {
  return category.startsWith(MCP_CANONICAL_PREFIX) && category.length > MCP_CANONICAL_PREFIX.length;
}

function isFileCategory(category: string): boolean {
  return FILE_CATEGORIES.includes(category);
}

/**
 * Pool's tool rules know one wildcard, `*`, which matches anything including
 * `/` — the same set a canonical `*` names — so a `**` run is collapsed to
 * keep the file in Pool's own spelling. `?`, `[...]` and `{a,b}` are literal
 * characters to Pool, so a pattern that relies on them cannot be written.
 */
function toPoolToolPattern(pattern: string): string | undefined {
  if (/[?[{]/.test(pattern)) return undefined;
  return pattern.replaceAll(/\*{2,}/g, "*");
}

/**
 * Pool's path globs know `*` and `**`, so a bare `*` run is written as `**`
 * to keep it matching anything. `?`, `[...]` and `{a,b}` are literal
 * characters to Pool here as well, so a pattern that relies on them cannot be
 * written.
 */
function toPoolPathPattern(pattern: string): string | undefined {
  if (/[?[{]/.test(pattern)) return undefined;
  return /^\*+$/.test(pattern) ? PATHS_CATCH_ALL_PATTERN : pattern;
}

function isHomeOrAbsolutePath(pattern: string): boolean {
  return isAbsolute(pattern) || pattern === "~" || pattern.startsWith("~/");
}

type PoolToolLists = {
  allow: string[];
  deny: string[];
};

type PoolPathEntry = {
  path: string;
  write?: true;
};

type PoolPathLists = {
  allow: PoolPathEntry[];
  deny: PoolPathEntry[];
};

type ActionRules = Record<string, PermissionAction>;

function rulesOf(permission: PermissionsConfig["permission"], category: string): ActionRules {
  return lookupOwn({ record: permission, key: category }) ?? {};
}

function patternsWithAction(rules: ActionRules, actions: readonly PermissionAction[]): string[] {
  return Object.entries(rules)
    .filter(([pattern, action]) => !isPrototypePollutionKey(pattern) && actions.includes(action))
    .map(([pattern]) => pattern);
}

function asRestrictions(patterns: readonly string[]) {
  return uniq(patterns).map((pattern) => ({ pattern, fromAllToolsCategory: false }));
}

function listPatterns(patterns: readonly string[]): string {
  return patterns.map((pattern) => quoteValueForWarning(pattern)).join(", ");
}

/**
 * Permissions adapter for Pool (Poolside's coding agent CLI).
 *
 * Pool keeps its permission rules in the same YAML settings file as its MCP
 * servers — `.poolside/settings.yaml` (project) / `~/.config/poolside/settings.yaml`
 * (global) — under two top-level keys:
 *   - `tools.<name>`: `allow` and `deny` pattern lists matched against the
 *     tool's argument (the command for `shell`, the URL for `web_fetch`, ...),
 *     plus `disabled: true` to remove the tool. A denied pattern wins over an
 *     allowed one; a call that matches neither prompts. Only `*` is a wildcard.
 *   - `paths`: `allow` entries (`{ path }`, read-only unless `write: true`)
 *     and `deny` entries (`{ path }`) with `*`/`**` globs; deny wins.
 *
 * Mapping (rulesync canonical -> Pool):
 *   - `bash` -> `tools.shell`, `webfetch` -> `tools.web_fetch`,
 *     `websearch` -> `tools.web_search`; any other non-file category passes
 *     through as `tools.<category>`. `allow` -> `allow`, `deny` -> `deny`,
 *     `ask` -> nothing (prompting is Pool's default) — but an `allow` that
 *     overlaps an `ask` of any category landing on the same Pool tool, or a
 *     deny Pool cannot spell, is withheld, since an allowed pattern would
 *     silence the prompt the config asks for.
 *   - `read` / `edit` / `write` -> `paths`: a `read` allow is a read-only
 *     entry, an `edit` or `write` allow adds `write: true`, a `read` deny is a
 *     deny entry. Pool cannot deny writes without denying reads, so an
 *     `edit`/`write` deny that is not also a `read` deny only withholds the
 *     write flag of the entries it overlaps (Pool prompts for those writes).
 *   - `mcp__<server>__<tool>` is skipped: Pool approves MCP tools per server
 *     under `mcp_servers.<server>.allow`, authored as `poolAllow` in
 *     `.rulesync/mcp.json`. The all-tools `*` category is mirrored onto
 *     `bash` by `honorAllToolsOnBash` and otherwise skipped.
 *
 * Project settings take project-relative paths and the user settings absolute
 * or `~` paths, so a path of the other kind is skipped with a warning at each
 * scope. The managed tools' `allow`/`deny` lists and, whenever the canonical
 * config carries a file category, the `paths` lists are rebuilt; every other
 * key (`disabled`, unmanaged tools, `mcp_servers`, `pool`, `sandbox`, ...) is
 * kept, and the file is never deleted.
 *
 * @see https://docs.poolside.ai/settings-file-reference
 */
export class PoolPermissions extends ToolPermissions {
  private readonly settings: Record<string, unknown>;

  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
    this.settings = parsePoolSettings(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getSettings(): Record<string, unknown> {
    return this.settings;
  }

  override isDeletable(): boolean {
    // settings.yaml is Pool's primary settings file, so it must never be
    // removed wholesale; retracting rules happens via an in-place merge.
    return false;
  }

  /**
   * settings.yaml is Pool's file: rulesync merges into it when it exists but
   * does not create one that holds nothing of its own — an absent file and an
   * absent rule both mean "prompt".
   */
  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return true;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: global ? POOL_GLOBAL_DIR : POOL_DIR,
      relativeFilePath: POOL_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<PoolPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new PoolPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<PoolPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parsePoolSettings(existingContent, filePath);

    const patch = buildPoolPermissionsPatch({
      config: rulesyncPermissions.getJson(),
      existing,
      global,
      logger,
    });

    return new PoolPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch,
        filePath,
        logger,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const rulesyncConfig = convertPoolToRulesync({
      tools: isRecord(this.settings[POOL_TOOLS_KEY]) ? this.settings[POOL_TOOLS_KEY] : {},
      paths: isRecord(this.settings[POOL_PATHS_KEY]) ? this.settings[POOL_PATHS_KEY] : {},
    });

    // Do not spread the full settings document: Pool's own keys
    // (`mcp_servers`, `pool`, `sandbox`, ...) must not leak into rulesync.
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(rulesyncConfig, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): PoolPermissions {
    // The shared settings file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new PoolPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}

/**
 * The deep-merge patch that rewrites the managed `tools.<name>` lists and,
 * when the canonical config carries a file category, the `paths` lists. An
 * empty list retracts its key (`undefined` deletes under deep-merge), and a
 * block is only touched when there is something to write into it or it
 * already exists, so a config without rules does not grow an empty
 * `tools: {}` / `paths: {}`.
 */
function buildPoolPermissionsPatch({
  config,
  existing,
  global,
  logger,
}: {
  config: PermissionsConfig;
  existing: Record<string, unknown>;
  global: boolean;
  logger?: Logger;
}): Record<string, unknown> {
  const permission = honorAllToolsOnBash(config.permission);
  const existingTools = isRecord(existing[POOL_TOOLS_KEY]) ? existing[POOL_TOOLS_KEY] : undefined;
  const existingPaths = isRecord(existing[POOL_PATHS_KEY]) ? existing[POOL_PATHS_KEY] : undefined;
  const patch: Record<string, unknown> = {};

  const toolsPatch: Record<string, unknown> = {};
  for (const [toolName, lists] of convertRulesyncToPoolTools({ permission, logger })) {
    const existingTool =
      existingTools === undefined ? undefined : lookupOwn({ record: existingTools, key: toolName });
    if (lists.allow.length === 0 && lists.deny.length === 0 && existingTool === undefined) {
      continue;
    }
    toolsPatch[toolName] = {
      [POOL_ALLOW_KEY]: lists.allow.length > 0 ? lists.allow : undefined,
      [POOL_DENY_KEY]: lists.deny.length > 0 ? lists.deny : undefined,
    };
  }
  if (Object.keys(toolsPatch).length > 0) {
    patch[POOL_TOOLS_KEY] = toolsPatch;
  }

  if (FILE_CATEGORIES.some((category) => lookupOwn({ record: permission, key: category }))) {
    const lists = convertRulesyncToPoolPaths({ permission, global, logger });
    if (lists.allow.length > 0 || lists.deny.length > 0 || existingPaths !== undefined) {
      patch[POOL_PATHS_KEY] = {
        [POOL_ALLOW_KEY]: lists.allow.length > 0 ? lists.allow : undefined,
        [POOL_DENY_KEY]: lists.deny.length > 0 ? lists.deny : undefined,
      };
    }
  }

  return patch;
}

/**
 * Convert one non-file category into a Pool tool's `allow`/`deny` lists. A
 * deny Pool can spell needs no withholding (Pool lets it win over an allow),
 * but an `ask` has no list of its own — a call Pool does not match prompts —
 * so an allow that overlaps one is withheld and reported, and the tool keeps
 * prompting. A deny Pool cannot spell (its pattern uses a glob form other
 * than `*`) is skipped, and then withholds the allows it overlaps the same
 * way: written, such an allow would auto-approve the very command the deny
 * was meant to stop. `restrictions` carries the ask patterns and the skipped
 * deny patterns of every category that lands on the same Pool tool, because
 * Pool matches the joined lists as one.
 */
function convertToolCategory({
  category,
  toolName,
  rules,
  restrictions,
  logger,
}: {
  category: string;
  toolName: string;
  rules: ActionRules;
  restrictions: readonly string[];
  logger?: Logger;
}): PoolToolLists {
  const lists: PoolToolLists = { allow: [], deny: [] };
  const shadowingRestrictions = createShadowingRestrictionsTest(asRestrictions(restrictions));

  for (const [rawPattern, action] of Object.entries(rules)) {
    if (isPrototypePollutionKey(rawPattern) || action === "ask") continue;
    const pattern = toPoolToolPattern(rawPattern);
    if (pattern === undefined) {
      logger?.warn(
        `Pool tool rules treat only "*" as a wildcard, so the "${action}" rule for ` +
          `"${category}" (pattern ${quoteValueForWarning(rawPattern)}) was skipped.`,
      );
      continue;
    }
    if (action === "deny") {
      lists.deny.push(pattern);
      continue;
    }
    const shadowing = shadowingRestrictions(rawPattern);
    if (shadowing.length > 0) {
      logger?.warn(
        `Pool has no list for an "ask" or for a deny it cannot spell (an unmatched call prompts), ` +
          `so the "allow" rule for "${category}" (pattern ${quoteValueForWarning(rawPattern)}) was ` +
          `withheld because it overlaps the restriction(s) ${listPatterns(shadowing)}; Pool keeps ` +
          `prompting for "${toolName}".`,
      );
      continue;
    }
    lists.allow.push(pattern);
  }

  return { allow: uniq(lists.allow), deny: uniq(lists.deny) };
}

// The deny patterns of a category that Pool cannot spell: skipped when the
// lists are written, so they can only be honored by withholding the allows
// they overlap.
function unrepresentableDenies(rules: ActionRules): string[] {
  return patternsWithAction(rules, ["deny"]).filter(
    (pattern) => toPoolToolPattern(pattern) === undefined,
  );
}

/**
 * Group the non-file categories by the Pool tool they land on, reporting the
 * ones Pool has no place for. Two categories can resolve to the same tool
 * (`bash` and a pass-through `shell`).
 */
function groupCategoriesByPoolTool({
  permission,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  logger?: Logger;
}): Map<string, [category: string, rules: ActionRules][]> {
  const byTool = new Map<string, [string, ActionRules][]>();

  for (const [category, rules] of Object.entries(permission)) {
    if (isPrototypePollutionKey(category) || isFileCategory(category)) continue;
    if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
      // `honorAllToolsOnBash` has already mirrored the restrictions onto bash.
      for (const [rawPattern, action] of Object.entries(rules)) {
        if (isPrototypePollutionKey(rawPattern)) continue;
        logger?.warn(
          `Pool has no rule that spans every tool, so the "${action}" rule for "*" ` +
            `(pattern ${quoteValueForWarning(rawPattern)}) was skipped.`,
        );
      }
      continue;
    }
    if (isMcpCategory(category)) {
      logger?.warn(
        `Pool approves MCP tools per server under "mcp_servers.<server>.allow", so the rules for ` +
          `"${category}" were skipped; author them as "poolAllow" on the server in .rulesync/mcp.json instead.`,
      );
      continue;
    }

    const toolName = toPoolToolName(category);
    byTool.set(toolName, [...(byTool.get(toolName) ?? []), [category, rules]]);
  }

  return byTool;
}

/**
 * Convert the non-file categories into Pool tool lists, keyed by Pool tool
 * name. The categories that land on the same tool are converted against the
 * union of their `ask` patterns and their lists are joined, which is safe
 * because a deny wins over an allow in Pool whichever category wrote it.
 */
function convertRulesyncToPoolTools({
  permission,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  logger?: Logger;
}): Map<string, PoolToolLists> {
  const byTool = new Map<string, PoolToolLists>();

  for (const [toolName, categories] of groupCategoriesByPoolTool({ permission, logger })) {
    const restrictions = categories.flatMap(([, rules]) => [
      ...patternsWithAction(rules, ["ask"]),
      ...unrepresentableDenies(rules),
    ]);
    const lists: PoolToolLists = { allow: [], deny: [] };
    for (const [category, rules] of categories) {
      const converted = convertToolCategory({ category, toolName, rules, restrictions, logger });
      lists.allow.push(...converted.allow);
      lists.deny.push(...converted.deny);
    }
    byTool.set(toolName, { allow: uniq(lists.allow), deny: uniq(lists.deny) });
  }

  return byTool;
}

/**
 * Convert the file categories into Pool's `paths` lists.
 *
 * An allow entry grants reading, and `write: true` grants writing on top, so
 * a `read` allow is withheld by an overlapping `read` ask and a write allow by
 * an overlapping `edit`/`write` ask — and by a `read` ask, since the write
 * entry would read too. A `read` deny lands in `paths.deny`, which Pool lets
 * win over any allow, and covers an `edit`/`write` deny of the same pattern,
 * so neither withholds anything; an `edit`/`write` deny without a `read` deny
 * cannot be written (Pool's deny blocks reads as well), so it is reported and
 * only withholds the write flags it overlaps. A deny Pool cannot spell is
 * skipped the same way and withholds the allows it overlaps, so it is honored
 * by prompting rather than dropped.
 */
function convertRulesyncToPoolPaths({
  permission,
  global,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  global: boolean;
  logger?: Logger;
}): PoolPathLists {
  const readRules = rulesOf(permission, READ_CATEGORY);
  const writeRulesByCategory = WRITE_CATEGORIES.map(
    (category) => [category, rulesOf(permission, category)] as const,
  );
  const readAsks = patternsWithAction(readRules, ["ask"]);

  const fitsScope = ({
    category,
    action,
    pattern,
  }: {
    category: string;
    action: PermissionAction;
    pattern: string;
  }): boolean => {
    if (isHomeOrAbsolutePath(pattern) === global) return true;
    logger?.warn(
      global
        ? `Pool's user settings take absolute or "~" paths, so the "${action}" rule for ` +
            `"${category}" (pattern ${quoteValueForWarning(pattern)}) was skipped; author it in ` +
            `${join(POOL_DIR, POOL_SETTINGS_FILE_NAME)} (without --global) instead.`
        : `Pool's project settings take project-relative paths, so the "${action}" rule for ` +
            `"${category}" (pattern ${quoteValueForWarning(pattern)}) was skipped; author it in ` +
            `~/${join(POOL_GLOBAL_DIR, POOL_SETTINGS_FILE_NAME)} (via --global) instead.`,
    );
    return false;
  };

  // Only a read deny that fits this scope and that Pool can spell reaches
  // `paths.deny`; one skipped for the other scope enforces nothing here, so
  // it exempts no write deny, and one Pool cannot spell withholds the allows
  // it overlaps instead.
  const deny: PoolPathEntry[] = [];
  const readRestrictions = [...readAsks];
  for (const pattern of patternsWithAction(readRules, ["deny"])) {
    const path = toPoolPathPattern(pattern);
    if (path === undefined) {
      warnSkippedPathPattern({ category: READ_CATEGORY, action: "deny", pattern, logger });
      readRestrictions.push(pattern);
      continue;
    }
    if (!fitsScope({ category: READ_CATEGORY, action: "deny", pattern })) continue;
    if (!deny.some((entry) => entry[POOL_PATH_KEY] === path)) deny.push({ [POOL_PATH_KEY]: path });
  }
  const isDeniedForRead = (pattern: string): boolean => {
    const path = toPoolPathPattern(pattern);
    return path !== undefined && deny.some((entry) => entry[POOL_PATH_KEY] === path);
  };

  // A write deny whose pattern a written read deny covers is enforced by Pool
  // itself, so only the ones Pool never sees withhold.
  const writeRestrictions = writeRulesByCategory.flatMap(([, rules]) => [
    ...patternsWithAction(rules, ["ask"]),
    ...patternsWithAction(rules, ["deny"]).filter((pattern) => !isDeniedForRead(pattern)),
  ]);

  reportUnwrittenWriteDenies({ writeRulesByCategory, isDeniedForRead, logger });

  const shadowingReadRestrictions = createShadowingRestrictionsTest(
    asRestrictions(readRestrictions),
  );
  const shadowingWriteRestrictions = createShadowingRestrictionsTest(
    asRestrictions([...readRestrictions, ...writeRestrictions]),
  );

  const allowByPath = new Map<string, PoolPathEntry>();
  for (const pattern of patternsWithAction(readRules, ["allow"])) {
    if (!fitsScope({ category: READ_CATEGORY, action: "allow", pattern })) continue;
    const path = toPoolPathPattern(pattern);
    if (path === undefined) {
      warnSkippedPathPattern({ category: READ_CATEGORY, action: "allow", pattern, logger });
      continue;
    }
    const shadowing = shadowingReadRestrictions(pattern);
    if (shadowing.length > 0) {
      logger?.warn(
        `Pool has no list for an "ask" or for a deny it cannot spell (an unmatched path prompts), ` +
          `so the "allow" rule for "read" (pattern ${quoteValueForWarning(pattern)}) was withheld ` +
          `because it overlaps the restriction(s) ${listPatterns(shadowing)}.`,
      );
      continue;
    }
    allowByPath.set(path, { [POOL_PATH_KEY]: path });
  }
  for (const [category, rules] of writeRulesByCategory) {
    for (const pattern of patternsWithAction(rules, ["allow"])) {
      if (!fitsScope({ category, action: "allow", pattern })) continue;
      const path = toPoolPathPattern(pattern);
      if (path === undefined) {
        warnSkippedPathPattern({ category, action: "allow", pattern, logger });
        continue;
      }
      const shadowing = shadowingWriteRestrictions(pattern);
      if (shadowing.length > 0) {
        logger?.warn(
          `A Pool path allowed with "write: true" can be read and written freely, so the "allow" ` +
            `rule for "${category}" (pattern ${quoteValueForWarning(pattern)}) was withheld because ` +
            `it overlaps the restriction(s) ${listPatterns(shadowing)}; Pool prompts for those writes.`,
        );
        continue;
      }
      allowByPath.set(path, { [POOL_PATH_KEY]: path, [POOL_WRITE_KEY]: true });
    }
  }

  return { allow: [...allowByPath.values()], deny };
}

function warnSkippedPathPattern({
  category,
  action,
  pattern,
  logger,
}: {
  category: string;
  action: PermissionAction;
  pattern: string;
  logger?: Logger;
}): void {
  logger?.warn(
    `Pool path rules treat only "*" and "**" as wildcards, so the "${action}" rule for ` +
      `"${category}" (pattern ${quoteValueForWarning(pattern)}) was skipped.`,
  );
}

// Report every write deny that no written read deny enforces: Pool prompts
// for those writes, and only the overlapping write flags are withheld.
function reportUnwrittenWriteDenies({
  writeRulesByCategory,
  isDeniedForRead,
  logger,
}: {
  writeRulesByCategory: ReadonlyArray<readonly [string, ActionRules]>;
  isDeniedForRead: (pattern: string) => boolean;
  logger?: Logger;
}): void {
  for (const [category, rules] of writeRulesByCategory) {
    for (const pattern of patternsWithAction(rules, ["deny"])) {
      if (isDeniedForRead(pattern)) continue;
      if (toPoolPathPattern(pattern) === undefined) {
        warnSkippedPathPattern({ category, action: "deny", pattern, logger });
        continue;
      }
      logger?.warn(
        `Pool cannot deny writes without denying reads, so the "deny" rule for "${category}" ` +
          `(pattern ${quoteValueForWarning(pattern)}) was not written and Pool prompts for those ` +
          `writes instead; deny the pattern under "read" as well to block it entirely.`,
      );
    }
  }
}

// A pattern a Pool list entry may carry: a non-empty string that is not an
// inherited-property name.
function isUsablePattern(pattern: unknown): pattern is string {
  return typeof pattern === "string" && pattern !== "" && !isPrototypePollutionKey(pattern);
}

// The `path` of one `paths` entry, or undefined for an entry without a usable one.
function pathOfEntry(entry: unknown): string | undefined {
  return isRecord(entry) && isUsablePattern(entry[POOL_PATH_KEY])
    ? entry[POOL_PATH_KEY]
    : undefined;
}

/**
 * Convert one `tools.<name>` block into its canonical bucket. A disabled tool
 * never runs, so it reads as a catch-all deny and its own lists are ignored;
 * a denied pattern wins over an allowed one, as it does in Pool.
 */
function importPoolTool({
  toolConfig,
  bucket,
}: {
  toolConfig: Record<string, unknown>;
  bucket: ActionRules;
}): void {
  if (toolConfig[POOL_DISABLED_KEY] === true) {
    bucket[CATCH_ALL_PATTERN] = "deny";
    return;
  }
  const denied = isStringArray(toolConfig[POOL_DENY_KEY]) ? toolConfig[POOL_DENY_KEY] : [];
  const allowed = isStringArray(toolConfig[POOL_ALLOW_KEY]) ? toolConfig[POOL_ALLOW_KEY] : [];
  for (const pattern of denied.filter(isUsablePattern)) {
    bucket[pattern] = "deny";
  }
  for (const pattern of allowed.filter(isUsablePattern)) {
    bucket[pattern] ??= "allow";
  }
}

/**
 * Convert Pool's `tools` and `paths` blocks back into a rulesync config.
 * `mcp_servers` approvals are the mcp feature's (`poolAllow`) and are not read.
 */
function convertPoolToRulesync({
  tools,
  paths,
}: {
  tools: Record<string, unknown>;
  paths: Record<string, unknown>;
}): PermissionsConfig {
  const permission: PermissionsConfig["permission"] = {};

  // Buckets are looked up as own properties only: a `toString` entry must
  // create its own record rather than write into the inherited function.
  const bucketFor = (category: string): ActionRules => {
    const own = lookupOwn({ record: permission, key: category });
    if (own !== undefined) return own;
    const created: ActionRules = {};
    permission[category] = created;
    return created;
  };
  for (const [toolName, toolConfig] of Object.entries(tools)) {
    if (isPrototypePollutionKey(toolName) || !isRecord(toolConfig)) continue;
    importPoolTool({ toolConfig, bucket: bucketFor(toCanonicalToolName(toolName)) });
  }

  const denyEntries = Array.isArray(paths[POOL_DENY_KEY]) ? paths[POOL_DENY_KEY] : [];
  const allowEntries = Array.isArray(paths[POOL_ALLOW_KEY]) ? paths[POOL_ALLOW_KEY] : [];
  for (const entry of denyEntries) {
    const path = pathOfEntry(entry);
    if (path === undefined) continue;
    for (const category of FILE_CATEGORIES) {
      bucketFor(category)[path] = "deny";
    }
  }
  for (const entry of allowEntries) {
    const path = pathOfEntry(entry);
    if (path === undefined) continue;
    bucketFor(READ_CATEGORY)[path] ??= "allow";
    if (isRecord(entry) && entry[POOL_WRITE_KEY] === true) {
      for (const category of WRITE_CATEGORIES) {
        bucketFor(category)[path] ??= "allow";
      }
    }
  }

  return { permission };
}
