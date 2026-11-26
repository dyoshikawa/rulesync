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
 * - The all-tools `*` key is written first, so a tool's own rules override
 *   its catch-all default. Each of its other `ask` / `deny` patterns is
 *   restated in every later key holding an overlapping looser rule, and its
 *   catch-all `*` is restated in a later key whose own catch-all is looser.
 * - Within each key, rules are resolved by {@link resolveKeyRules} and ordered
 *   by {@link orderForDeepcode}.
 * - A key left with only a catch-all is written in DeepCode's plain-string
 *   form (`"web_fetch": "ask"`).
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
}): Record<string, string | Rules> {
  const byTool = groupByDeepcodeTool({ permission, logger });
  const allTools = byTool.get(ALL_TOOLS_PERMISSION_CATEGORY);
  const allToolsRestrictions = Object.entries(allTools ?? {}).filter(
    ([, action]) => action !== "allow",
  );

  const raised: string[] = [];
  const withheld: string[] = [];
  const result: Record<string, string | Rules> = {};
  const orderedKeys = [
    ...(allTools ? [ALL_TOOLS_PERMISSION_CATEGORY] : []),
    ...[...byTool.keys()].filter((key) => key !== ALL_TOOLS_PERMISSION_CATEGORY),
  ];
  for (const toolKey of orderedKeys) {
    const own: KeyRule[] = Object.entries(byTool.get(toolKey) ?? {}).map(([pattern, action]) => ({
      pattern,
      action,
      restated: false,
    }));
    const rules =
      toolKey === ALL_TOOLS_PERMISSION_CATEGORY
        ? own
        : restateAllToolsRestrictions({ rules: own, restrictions: allToolsRestrictions });
    const resolved = resolveKeyRules({ rules, toolKey, raised, withheld });
    if (resolved.length === 0) continue;
    const [only] = resolved;
    result[toolKey] =
      resolved.length === 1 && only && only.pattern === CATCH_ALL_PATTERN
        ? only.action
        : Object.fromEntries(resolved.map((rule) => [rule.pattern, rule.action]));
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
 * Restate the all-tools key's `ask` / `deny` patterns in a later tool key,
 * whose rules DeepCode matches after them: a same-pattern rule takes the
 * stricter action, and any other non-catch-all restriction is added when it
 * overlaps a looser rule of the key. The all-tools catch-all is the default a
 * tool's own rules override, so it is restated only over the same pattern.
 */
function restateAllToolsRestrictions({
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
 * Read DeepCode's `security.permissions` back into canonical form. A plain
 * string is a catch-all rule. Each key's patterns are listed in the order
 * DeepCode evaluates them (by specificity, ties in file order), so a reader
 * that applies the last matching canonical rule decides as DeepCode does.
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
  const shared: Record<string, Rules> = {};
  const toolScoped: Record<string, Rules> = {};
  const invalid: string[] = [];
  for (const [toolKey, spec] of Object.entries(permissions)) {
    if (isPrototypePollutionKey(toolKey)) continue;
    const entries: Array<[string, unknown]> =
      typeof spec === "string"
        ? [[CATCH_ALL_PATTERN, spec]]
        : isRecord(spec)
          ? Object.entries(spec)
          : [];
    if (typeof spec !== "string" && !isRecord(spec)) {
      invalid.push(quoteValueForWarning(toolKey));
      continue;
    }
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
