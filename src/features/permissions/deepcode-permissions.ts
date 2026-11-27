import { join } from "node:path";

import {
  DEEPCODE_CONFIG_FILE_NAME,
  DEEPCODE_DIR,
  DEEPCODE_PERMISSIONS_KEY,
  DEEPCODE_SECURITY_KEY,
} from "../../constants/deepcode-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import { isPermissionAction, type PermissionAction } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfigFile,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  CATCH_ALL_PATTERN,
  createShadowingRestrictionsTest,
} from "./shell-command-categories.js";
import { isStricterAction, PERMISSION_ACTION_PRIORITY } from "./single-action-collapse.js";
import {
  ToolPermissions,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const TOOL_LABEL = "DeepCode";

/** The tool-scoped override key, also where import routes unmapped tool names. */
const DEEPCODE_OVERRIDE_KEY = "deepcode";

type Rules = Record<string, PermissionAction>;

/**
 * Canonical categories and the DeepCode tool each one names in
 * `security.permissions`. DeepCode matches a rule's pattern against the
 * command line (`bash`), the path argument (`read`, `write`, `edit`, `grep`,
 * `glob`) or, for a tool with no path argument, `key=value` pairs of the call
 * (`web_fetch` is matched against `url=<URL>`). The all-tools `*` category is
 * DeepCode's `*` tool-name wildcard.
 *
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/configuration.md#permission-rules
 */
const CATEGORY_TO_DEEPCODE_TOOL: Readonly<Record<string, string>> = {
  [ALL_TOOLS_PERMISSION_CATEGORY]: ALL_TOOLS_PERMISSION_CATEGORY,
  bash: "bash",
  read: "read",
  write: "write",
  edit: "edit",
  grep: "grep",
  glob: "glob",
  webfetch: "web_fetch",
  agent: "spawn_agent",
};

const DEEPCODE_TOOL_TO_CATEGORY: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CATEGORY_TO_DEEPCODE_TOOL).map(([category, tool]) => [tool, category]),
);

/** Canonical categories DeepCode has no tool for. */
const UNSUPPORTED_CATEGORIES: ReadonlySet<string> = new Set(["websearch", "notebookedit"]);

/**
 * How specific DeepCode considers a pattern: `*` is the least specific, any
 * other pattern counts its characters that are not `*` or `?`. DeepCode sorts
 * each tool's patterns by this value (stable) and applies the last match, so
 * the more specific pattern wins whatever the JSON order, and file order only
 * breaks ties.
 */
export function deepcodePatternSpecificity(pattern: string): number {
  if (pattern === CATCH_ALL_PATTERN) return 0;
  let count = 0;
  for (const character of pattern) {
    if (character !== "*" && character !== "?") count += 1;
  }
  return count;
}

function patternsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    createShadowingRestrictionsTest([{ pattern: left, fromAllToolsCategory: true }])(right).length >
      0
  );
}

type KeyRule = { pattern: string; action: PermissionAction; restated: boolean };

/**
 * Order rules the way DeepCode evaluates them (specificity ascending), with
 * ties ordered allow, ask, deny so the strictest of two equally specific
 * matching rules is the last match.
 */
function orderForDeepcode(rules: KeyRule[]): KeyRule[] {
  return rules.toSorted(
    (a, b) =>
      deepcodePatternSpecificity(a.pattern) - deepcodePatternSpecificity(b.pattern) ||
      PERMISSION_ACTION_PRIORITY[a.action] - PERMISSION_ACTION_PRIORITY[b.action],
  );
}

/**
 * Whether `looser` would beat `stricter` in DeepCode on an input both match:
 * it is more specific. (Equal specificity is settled by
 * {@link orderForDeepcode}.) A catch-all `*` — the key's own, or the
 * all-tools one restated over it — is the documented default a narrower rule
 * carves out of (`{"*": "ask", "git *": "allow"}`), so an authored rule
 * beating it is intended.
 */
function beats({ looser, stricter }: { looser: KeyRule; stricter: KeyRule }): boolean {
  if (stricter.pattern === CATCH_ALL_PATTERN && !looser.restated) {
    return false;
  }
  return (
    deepcodePatternSpecificity(looser.pattern) > deepcodePatternSpecificity(stricter.pattern) &&
    patternsOverlap(looser.pattern, stricter.pattern)
  );
}

/**
 * Make one tool key's rules safe under DeepCode's most-specific-wins order: no
 * rule may end up looser than a stricter rule that also matches the input.
 *
 * - An `ask` a more specific position would let beat an overlapping `deny` is
 *   raised to `deny` (dropping it would let the inputs only it covered fall
 *   to a looser rule).
 * - An `allow` that would beat an overlapping `ask` or `deny` is withheld; its
 *   inputs fall to the stricter rule or to DeepCode's own default.
 */
function resolveKeyRules({
  rules,
  toolKey,
  raised,
  withheld,
}: {
  rules: KeyRule[];
  toolKey: string;
  raised: string[];
  withheld: string[];
}): KeyRule[] {
  const denies = rules.filter((rule) => rule.action === "deny");
  const afterRaise = rules.map((rule) => {
    if (rule.action !== "ask") return rule;
    if (!denies.some((deny) => beats({ looser: rule, stricter: deny }))) return rule;
    raised.push(describeRule(toolKey, rule.pattern));
    return { ...rule, action: "deny" as const };
  });
  const restrictions = afterRaise.filter((rule) => rule.action !== "allow");
  const kept = afterRaise.filter((rule) => {
    if (rule.action !== "allow") return true;
    if (!restrictions.some((restriction) => beats({ looser: rule, stricter: restriction }))) {
      return true;
    }
    withheld.push(describeRule(toolKey, rule.pattern));
    return false;
  });
  return orderForDeepcode(kept);
}

function describeRule(toolKey: string, pattern: string): string {
  return `${quoteValueForWarning(toolKey)} ${quoteValueForWarning(pattern)}`;
}

/** Fold `rules` into `target`, keeping the stricter action on a shared pattern. */
function mergeStricter({ target, rules }: { target: Rules; rules: Rules }): void {
  for (const [pattern, action] of Object.entries(rules)) {
    if (isPrototypePollutionKey(pattern)) continue;
    const existing = Object.hasOwn(target, pattern) ? target[pattern] : undefined;
    if (isStricterAction({ action, existing })) {
      target[pattern] = action;
    }
  }
}

/** Whether a DeepCode tool key is a tool-name wildcard rather than one tool's name. */
function isToolWildcard(toolKey: string): boolean {
  return /[*?[]/.test(toolKey);
}

/**
 * Whether the rules under tool key `broad` can apply to calls of tool key
 * `narrow`: `broad` is a wildcard that matches `narrow`'s name, or overlaps
 * `narrow`'s own wildcard. Over-reports, the direction that restricts.
 */
function toolKeyCovers({ broad, narrow }: { broad: string; narrow: string }): boolean {
  if (broad === narrow || !isToolWildcard(broad)) return false;
  return patternsOverlap(broad, narrow);
}

/**
 * Write order for DeepCode tool keys: wildcards first, least specific first
 * (`*` leads), then concrete tool names in their canonical order. DeepCode
 * lets a later key override an earlier one, so a tool's own rules override
 * the defaults a broader wildcard sets.
 */
function orderToolKeys(keys: string[]): string[] {
  const wildcards = keys
    .filter((key) => isToolWildcard(key))
    .toSorted((a, b) => deepcodePatternSpecificity(a) - deepcodePatternSpecificity(b));
  return [...wildcards, ...keys.filter((key) => !isToolWildcard(key))];
}

/**
 * Translate the effective canonical permission block into DeepCode's
 * `security.permissions` map.
 *
 * DeepCode flattens the map into one rule list (tool keys in JSON order, each
 * key's patterns sorted by {@link deepcodePatternSpecificity}) and applies the
 * last rule whose tool-name wildcard and pattern both match. Canonically the
 * stricter rule wins (`deny` > `ask` > `allow`), so the output is arranged to
 * never let a looser rule win where the canonical config restricts:
 *
 * - Wildcard tool keys are written first (`*` leading, then narrower
 *   wildcards such as `mcp__github__*`), then concrete tools, so a tool's own
 *   rules override the defaults a wildcard sets. Each wildcard's other
 *   `ask` / `deny` patterns are restated in every later key it covers that
 *   holds an overlapping looser rule, and its catch-all `*` is restated over
 *   a looser catch-all of such a key.
 * - Within each key, rules are resolved by {@link resolveKeyRules} and ordered
 *   by {@link orderForDeepcode}.
 * - Every key is written as a pattern map, never DeepCode's plain-string
 *   form: DeepCode deep-merges the project file over the user file, and a
 *   string would replace the user's whole map for that tool.
 * - A `write` / `edit` catch-all `ask` or `deny` also covers `apply_patch`,
 *   which edits files without a path argument rules could match.
 *
 * Categories DeepCode has no tool for (`websearch`, `notebookedit`) are
 * skipped with a warning; any other category name is written as a DeepCode
 * tool name as it stands (`apply_patch`, `mcp__github__*`, ...).
 */
export function convertToDeepcodePermissions({
  permission,
  logger,
}: {
  permission: Record<string, Rules>;
  logger?: Logger;
}): Record<string, Rules> {
  const byTool = groupByDeepcodeTool({ permission, logger });
  coverApplyPatch({ byTool, logger });

  const raised: string[] = [];
  const withheld: string[] = [];
  const result: Record<string, Rules> = {};
  const orderedKeys = orderToolKeys([...byTool.keys()]);
  for (const [index, toolKey] of orderedKeys.entries()) {
    let rules: KeyRule[] = Object.entries(byTool.get(toolKey) ?? {}).map(([pattern, action]) => ({
      pattern,
      action,
      restated: false,
    }));
    for (const broad of orderedKeys.slice(0, index)) {
      if (!toolKeyCovers({ broad, narrow: toolKey })) continue;
      const restrictions = Object.entries(byTool.get(broad) ?? {}).filter(
        ([, action]) => action !== "allow",
      );
      rules = restateBroaderRestrictions({ rules, restrictions });
    }
    const resolved = resolveKeyRules({ rules, toolKey, raised, withheld });
    if (resolved.length === 0) continue;
    result[toolKey] = Object.fromEntries(resolved.map((rule) => [rule.pattern, rule.action]));
  }

  if (raised.length > 0) {
    warnWithFallback(
      logger,
      `${TOOL_LABEL} applies the most specific matching pattern, so the ask rule(s) for ${raised.join(", ")} were written as deny: a broader deny covers the same inputs and the narrower ask would otherwise override it.`,
    );
  }
  if (withheld.length > 0) {
    warnWithFallback(
      logger,
      `${TOOL_LABEL} applies the most specific matching pattern, so the allow rule(s) for ${withheld.join(", ")} were withheld: a broader ask or deny covers the same inputs and the narrower allow would otherwise override it.`,
    );
  }
  return result;
}

/** DeepCode's patch tool, which writes files without a path argument. */
const APPLY_PATCH_TOOL = "apply_patch";

/**
 * Carry a `write` / `edit` catch-all `ask` or `deny` over to `apply_patch`,
 * which DeepCode matches against the whole call rather than a path, so only a
 * catch-all reaches it. Path-specific `write` / `edit` restrictions cannot be
 * carried over, which is warned about.
 */
function coverApplyPatch({
  byTool,
  logger,
}: {
  byTool: Map<string, Rules>;
  logger?: Logger;
}): void {
  const fileTools = ["write", "edit"].map((tool) => byTool.get(tool) ?? {});
  const catchAllRestrictions = fileTools
    .map((rules) =>
      Object.hasOwn(rules, CATCH_ALL_PATTERN) ? rules[CATCH_ALL_PATTERN] : undefined,
    )
    .filter((action): action is PermissionAction => action !== undefined && action !== "allow");
  if (catchAllRestrictions.length > 0) {
    const target = byTool.get(APPLY_PATCH_TOOL) ?? {};
    for (const action of catchAllRestrictions) {
      mergeStricter({ target, rules: { [CATCH_ALL_PATTERN]: action } });
    }
    byTool.set(APPLY_PATCH_TOOL, target);
  }
  const pathRestrictions = fileTools.flatMap((rules) =>
    Object.entries(rules).filter(
      ([pattern, action]) => pattern !== CATCH_ALL_PATTERN && action !== "allow",
    ),
  );
  if (pathRestrictions.length > 0) {
    warnWithFallback(
      logger,
      `${TOOL_LABEL}'s ${APPLY_PATCH_TOOL} tool is not matched by path, so the write/edit rule(s) for ${pathRestrictions.map(([pattern]) => quoteValueForWarning(pattern)).join(", ")} do not restrict it; add a "${DEEPCODE_OVERRIDE_KEY}.permission.${APPLY_PATCH_TOOL}" rule to restrict patches as well.`,
    );
  }
}

/**
 * Group the canonical categories by the DeepCode tool key they map to,
 * skipping (with a warning) the categories DeepCode has no tool for.
 */
function groupByDeepcodeTool({
  permission,
  logger,
}: {
  permission: Record<string, Rules>;
  logger?: Logger;
}): Map<string, Rules> {
  const byTool = new Map<string, Rules>();
  const skipped: string[] = [];
  for (const [category, rules] of Object.entries(permission)) {
    if (isPrototypePollutionKey(category) || !isRecord(rules)) continue;
    if (UNSUPPORTED_CATEGORIES.has(category)) {
      if (Object.keys(rules).length > 0) skipped.push(category);
      continue;
    }
    const toolKey = CATEGORY_TO_DEEPCODE_TOOL[category] ?? category;
    const target = byTool.get(toolKey) ?? {};
    mergeStricter({ target, rules });
    byTool.set(toolKey, target);
  }
  if (skipped.length > 0) {
    warnWithFallback(
      logger,
      `${TOOL_LABEL} has no tool for the permission categories ${skipped.map((c) => quoteValueForWarning(c)).join(", ")}, so their rules were not written.`,
    );
  }
  return byTool;
}

/**
 * Restate a broader wildcard key's `ask` / `deny` patterns in a later tool
 * key it covers, whose rules DeepCode matches after them: a same-pattern rule
 * takes the stricter action, and any other non-catch-all restriction is added
 * when it overlaps a looser rule of the key. The wildcard's catch-all is the
 * default a tool's own rules override, so it is restated only over the same
 * pattern.
 */
function restateBroaderRestrictions({
  rules,
  restrictions,
}: {
  rules: KeyRule[];
  restrictions: Array<[string, PermissionAction]>;
}): KeyRule[] {
  const result = [...rules];
  for (const [pattern, action] of restrictions) {
    const index = result.findIndex((rule) => rule.pattern === pattern);
    const existing = index === -1 ? undefined : result[index];
    if (existing) {
      if (isStricterAction({ action, existing: existing.action })) {
        result[index] = { pattern, action, restated: true };
      }
      continue;
    }
    if (pattern === CATCH_ALL_PATTERN) continue;
    const overlapsLooser = result.some(
      (rule) =>
        isStricterAction({ action, existing: rule.action }) &&
        patternsOverlap(pattern, rule.pattern),
    );
    if (overlapsLooser) {
      result.push({ pattern, action, restated: true });
    }
  }
  return result;
}

/**
 * Parse one DeepCode tool key's spec into rules in the order DeepCode
 * evaluates them (by specificity, ties in file order), or `undefined` for a
 * spec that is neither a string nor a map. Unknown actions are collected in
 * `invalid`.
 */
function parseDeepcodeSpec({
  toolKey,
  spec,
  invalid,
}: {
  toolKey: string;
  spec: unknown;
  invalid: string[];
}): Rules | undefined {
  if (typeof spec !== "string" && !isRecord(spec)) {
    invalid.push(quoteValueForWarning(toolKey));
    return undefined;
  }
  const entries: Array<[string, unknown]> =
    typeof spec === "string" ? [[CATCH_ALL_PATTERN, spec]] : Object.entries(spec);
  const rules: Rules = {};
  const ordered = entries
    .filter(([pattern]) => !isPrototypePollutionKey(pattern))
    .toSorted(([a], [b]) => deepcodePatternSpecificity(a) - deepcodePatternSpecificity(b));
  for (const [pattern, rawAction] of ordered) {
    const action = typeof rawAction === "string" ? rawAction.toLowerCase() : rawAction;
    if (!isPermissionAction(action)) {
      invalid.push(describeRule(toolKey, pattern));
      continue;
    }
    rules[pattern] = action;
  }
  return rules;
}

/**
 * Fold a later key's restriction into an earlier key it covers, as DeepCode
 * lets the later key override it: the earlier key's looser rules that
 * overlap the restriction would lose to it, so an `allow` is dropped and an
 * `ask` under a `deny` becomes `deny` (dropping it could let inputs only it
 * covered fall to a looser rule); then the restriction itself is added,
 * keeping the stricter action on a shared pattern.
 */
function foldLaterRestriction({
  rules,
  pattern,
  action,
}: {
  rules: Rules;
  pattern: string;
  action: PermissionAction;
}): Rules {
  const result: Rules = {};
  for (const [ownPattern, ownAction] of Object.entries(rules)) {
    if (
      !isStricterAction({ action, existing: ownAction }) ||
      !patternsOverlap(pattern, ownPattern)
    ) {
      result[ownPattern] = ownAction;
      continue;
    }
    if (ownAction === "ask") {
      result[ownPattern] = "deny";
    }
  }
  const existing = Object.hasOwn(result, pattern) ? result[pattern] : undefined;
  if (isStricterAction({ action, existing })) {
    result[pattern] = action;
  }
  return result;
}

/**
 * Read DeepCode's `security.permissions` back into canonical form without
 * loosening it. A plain string is a catch-all rule, and each key's patterns
 * are listed in the order DeepCode evaluates them, so a reader that applies
 * the last matching canonical rule decides as DeepCode does within a key.
 * Across keys DeepCode lets a later key override an earlier one, so each
 * later wildcard key's `ask` / `deny` rules are folded into the earlier keys
 * it covers (see {@link foldLaterRestriction}); a later key's `allow` over an
 * earlier restriction is not carried over, which only tightens.
 *
 * Tool names with a canonical category land in the shared `permission`
 * block; any other tool name (`apply_patch`, `multi_edit`, MCP tools,
 * wildcards) lands in the tool-scoped `deepcode.permission` block, so it is
 * written back for DeepCode only. Actions DeepCode does not know are skipped
 * with a warning.
 */
export function convertFromDeepcodePermissions({
  permissions,
  logger,
}: {
  permissions: Record<string, unknown>;
  logger?: Logger;
}): { shared: Record<string, Rules>; toolScoped: Record<string, Rules> } {
  const invalid: string[] = [];
  const parsed: Array<[string, Rules]> = [];
  for (const [toolKey, spec] of Object.entries(permissions)) {
    if (isPrototypePollutionKey(toolKey)) continue;
    const rules = parseDeepcodeSpec({ toolKey, spec, invalid });
    if (rules !== undefined) parsed.push([toolKey, rules]);
  }
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const entry = parsed[index];
    if (!entry) continue;
    const [toolKey] = entry;
    let rules = entry[1];
    for (const [laterKey, laterRules] of parsed.slice(index + 1)) {
      if (!toolKeyCovers({ broad: laterKey, narrow: toolKey })) continue;
      for (const [pattern, action] of Object.entries(laterRules)) {
        if (action === "allow") continue;
        rules = foldLaterRestriction({ rules, pattern, action });
      }
    }
    // Keep the evaluation order after folding, so a stricter, more specific
    // own rule stays after a folded broader one.
    parsed[index] = [
      toolKey,
      Object.fromEntries(
        Object.entries(rules).toSorted(
          ([a], [b]) => deepcodePatternSpecificity(a) - deepcodePatternSpecificity(b),
        ),
      ),
    ];
  }

  const shared: Record<string, Rules> = {};
  const toolScoped: Record<string, Rules> = {};
  for (const [toolKey, rules] of parsed) {
    if (Object.keys(rules).length === 0) continue;
    const category = DEEPCODE_TOOL_TO_CATEGORY[toolKey];
    if (category !== undefined) {
      shared[category] = rules;
    } else {
      toolScoped[toolKey] = rules;
    }
  }
  if (invalid.length > 0) {
    warnWithFallback(
      logger,
      `${TOOL_LABEL} permission rule(s) ${invalid.join(", ")} were not imported: the action must be "allow", "ask" or "deny".`,
    );
  }
  return { shared, toolScoped };
}

/**
 * Permissions generator for DeepCode.
 *
 * DeepCode reads per-tool rules from `security.permissions` in
 * `deepcode_config.json`: the project file at the project root and the user
 * file `~/.deepcode/deepcode_config.json`. A `deny` rule applies under every
 * access preset. The file also holds settings rulesync does not own, so only
 * `security.permissions` is replaced; `security.accessPreset`, `sandbox` and
 * every other key are kept, and the file is never deleted.
 *
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/configuration.md#permission-rules
 */
export class DeepcodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: global ? DEEPCODE_DIR : ".",
      relativeFilePath: DEEPCODE_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<DeepcodePermissions> {
    const paths = DeepcodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new DeepcodePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<DeepcodePermissions> {
    const paths = DeepcodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so generation stays side-effect-free under
    // `--dry-run`/`--check`; the write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseSharedConfigFile({
      fileKey: sharedConfigFileKey(paths),
      fileContent: existingContent,
      filePath,
    });

    const permissions = convertToDeepcodePermissions({
      permission: rulesyncPermissions.getJson().permission,
      logger,
    });

    // `security` is owned as a whole key, so its other settings
    // (`accessPreset`, `sandbox`, ...) are carried over before the rules
    // snapshot replaces `permissions`.
    const security: Record<string, unknown> = isRecord(existing[DEEPCODE_SECURITY_KEY])
      ? { ...existing[DEEPCODE_SECURITY_KEY] }
      : {};
    if (Object.keys(permissions).length > 0) {
      security[DEEPCODE_PERMISSIONS_KEY] = permissions;
    } else {
      delete security[DEEPCODE_PERMISSIONS_KEY];
    }

    return new DeepcodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          [DEEPCODE_SECURITY_KEY]: Object.keys(security).length > 0 ? security : undefined,
        },
        filePath,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions({ logger }: { logger?: Logger } = {}): RulesyncPermissions {
    let document: Record<string, unknown>;
    try {
      document = parseSharedConfigFile({
        fileKey: sharedConfigFileKey(DeepcodePermissions.getSettablePaths({ global: this.global })),
        fileContent: this.getFileContent(),
        filePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
      });
    } catch (error) {
      throw new Error(
        `Failed to parse DeepCode config in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const security = isRecord(document[DEEPCODE_SECURITY_KEY])
      ? document[DEEPCODE_SECURITY_KEY]
      : {};
    const permissions = isRecord(security[DEEPCODE_PERMISSIONS_KEY])
      ? security[DEEPCODE_PERMISSIONS_KEY]
      : {};
    const { shared, toolScoped } = convertFromDeepcodePermissions({ permissions, logger });

    const config: Record<string, unknown> = { permission: shared };
    if (Object.keys(toolScoped).length > 0) {
      config[DEEPCODE_OVERRIDE_KEY] = { permission: toolScoped };
    }
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }
}
