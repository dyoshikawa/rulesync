import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  bashRulesHonoringAllTools,
  CATCH_ALL_PATTERN,
  createShadowingRestrictionsTest,
  SHELL_PERMISSION_CATEGORY,
} from "./shell-command-categories.js";

type Permission = PermissionsConfig["permission"];

/** One allow rule left out of a tool's config, named as `<category>: <pattern>`. */
function describeRule(category: string, pattern: string): string {
  return `${category}: ${pattern}`;
}

/**
 * The `*` category with only its catch-all entries left, warning about the
 * pattern-specific ones dropped.
 */
function keepAllToolsCatchAll({
  rules,
  isCatchAll,
  toolLabel,
  logger,
}: {
  rules: Record<string, PermissionAction>;
  isCatchAll: (pattern: string) => boolean;
  toolLabel: string;
  logger?: Logger;
}): Record<string, PermissionAction> {
  const kept: Record<string, PermissionAction> = {};
  const dropped: string[] = [];
  for (const [pattern, action] of Object.entries(rules)) {
    if (isCatchAll(pattern)) {
      kept[pattern] = action;
    } else {
      dropped.push(`${pattern} (${action})`);
    }
  }
  if (dropped.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} has no rule that scopes a pattern to every tool, so the all-tools '*' ` +
        `rule(s) for ${dropped.join(", ")} were not written as such; a deny or ask among them ` +
        `is honored by withholding the allow rules it covers in the other categories.`,
    );
  }
  return kept;
}

/**
 * Apply the all-tools `*` category's restrictions to every other category, for
 * a tool that cannot write a pattern-specific rule spanning every tool.
 *
 * A `deny` or `ask` written under `*` covers every tool — `{"*": {".env":
 * "deny"}}` denies reading `.env` as surely as `{"read": {".env": "deny"}}`
 * does. A tool with no such rule would otherwise keep a `read: {"*": "allow"}`
 * beside it and auto-approve the very file the author denied. So:
 *
 * - `bash` gets the restrictions copied in, exactly as `honorAllToolsOnBash`
 *   does, since a command list can carry them.
 * - Every other category loses each `allow` that names an input a `*`
 *   restriction also names (see `createShadowingRestrictionsTest`); the tool
 *   then falls back to its own prompt or default for it, the safe direction.
 * - With `dropAllToolsPatterns`, the pattern-specific entries of `*` itself are
 *   removed, for a tool that would otherwise write them as an inert literal
 *   `*(<pattern>)` rule. They are honored by the withholding above.
 *
 * `writesAllToolsCatchAll` says the tool already enforces a `*` catch-all
 * (`{"*": {"*": "ask"}}`) natively over its per-tool allows, so the catch-all
 * is left out of the withholding. `isCatchAll` says which spellings the tool
 * reads as that catch-all (by default only `*`).
 *
 * Every withheld allow is named in one warning.
 */
export function honorAllToolsRestrictions({
  permission,
  toolLabel,
  logger,
  writesAllToolsCatchAll = false,
  dropAllToolsPatterns = false,
  isCatchAll = (pattern) => pattern === CATCH_ALL_PATTERN,
}: {
  permission: Permission;
  toolLabel: string;
  logger?: Logger;
  writesAllToolsCatchAll?: boolean;
  dropAllToolsPatterns?: boolean;
  isCatchAll?: (pattern: string) => boolean;
}): Permission {
  const allToolsRules = Object.hasOwn(permission, ALL_TOOLS_PERMISSION_CATEGORY)
    ? permission[ALL_TOOLS_PERMISSION_CATEGORY]
    : undefined;
  if (allToolsRules === undefined) {
    return permission;
  }
  const restrictions = Object.entries(allToolsRules)
    .filter(
      ([pattern, action]) =>
        action !== "allow" &&
        !isPrototypePollutionKey(pattern) &&
        !(writesAllToolsCatchAll && isCatchAll(pattern)),
    )
    .map(([pattern]) => ({ pattern, fromAllToolsCategory: true }));

  const result: Permission = {};
  const withheld: string[] = [];
  const shadowingRestrictions = createShadowingRestrictionsTest(restrictions);

  for (const [category, rules] of Object.entries(permission)) {
    if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
      const kept = dropAllToolsPatterns
        ? keepAllToolsCatchAll({ rules, isCatchAll, toolLabel, logger })
        : rules;
      if (!dropAllToolsPatterns || Object.keys(kept).length > 0) {
        result[category] = kept;
      }
      continue;
    }
    if (restrictions.length === 0) {
      result[category] = rules;
      continue;
    }
    if (category === SHELL_PERMISSION_CATEGORY) {
      const bash = bashRulesHonoringAllTools({
        ...permission,
        [ALL_TOOLS_PERMISSION_CATEGORY]: Object.fromEntries(
          restrictions.map(({ pattern }) => [pattern, allToolsRules[pattern] ?? "deny"]),
        ),
      });
      for (const [pattern, action] of Object.entries(rules)) {
        if (action === "allow" && bash[pattern] === undefined) {
          withheld.push(describeRule(category, pattern));
        }
      }
      result[category] = bash;
      continue;
    }
    const kept: Record<string, PermissionAction> = {};
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "allow" && shadowingRestrictions(pattern).length > 0) {
        withheld.push(describeRule(category, pattern));
        continue;
      }
      kept[pattern] = action;
    }
    result[category] = kept;
  }

  if (withheld.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} was not given the allow rule(s) for ${withheld.join(", ")} because a deny or ` +
        `ask rule under the all-tools '*' category restricts the same inputs, and the stricter ` +
        `rule wins whatever its width.`,
    );
  }
  return result;
}

/**
 * Withhold every `allow` that an `ask` the tool cannot write also covers, for a
 * tool with no ask tier on some surface.
 *
 * Such a tool prompts for whatever it does not auto-approve, so skipping the
 * `ask` alone is right — but only if no `allow` beside it auto-approves the
 * same input. The canonical order is `deny > ask > allow`, so `{"git *":
 * "allow", "git push *": "ask"}` must not leave `git *` auto-approved.
 *
 * Within each group (categories the tool folds into one surface share a group;
 * by default each category is its own), a pattern-specific `allow` an `ask`
 * overlaps is removed. A catch-all `*` `allow` is downgraded to `ask` instead,
 * so a tool that has a coarse prompting default for the whole surface (Vibe's
 * `permission = "ask"`) uses it; a tool that skips `ask` drops it either way.
 *
 * `isSkippedAsk` picks the `ask` rules the tool cannot write (by default every
 * one). Every withheld allow is named in one warning.
 */
export function withholdAllowsShadowedByAsks({
  permission,
  toolLabel,
  logger,
  isSkippedAsk = () => true,
  groupOf = (category) => category,
}: {
  permission: Permission;
  toolLabel: string;
  logger?: Logger;
  isSkippedAsk?: (params: { category: string; pattern: string }) => boolean;
  groupOf?: (category: string) => string;
}): Permission {
  const asksByGroup = new Map<string, string[]>();
  for (const [category, rules] of Object.entries(permission)) {
    for (const [pattern, action] of Object.entries(rules)) {
      if (action !== "ask" || isPrototypePollutionKey(pattern)) continue;
      if (!isSkippedAsk({ category, pattern })) continue;
      const group = groupOf(category);
      asksByGroup.set(group, [...(asksByGroup.get(group) ?? []), pattern]);
    }
  }
  if (asksByGroup.size === 0) {
    return permission;
  }

  const testByGroup = new Map(
    [...asksByGroup].map(([group, asks]) => [
      group,
      createShadowingRestrictionsTest(
        asks.map((pattern) => ({ pattern, fromAllToolsCategory: false })),
      ),
    ]),
  );
  const result: Permission = {};
  const withheld: string[] = [];
  for (const [category, rules] of Object.entries(permission)) {
    const shadowingAsks = testByGroup.get(groupOf(category));
    if (shadowingAsks === undefined) {
      result[category] = rules;
      continue;
    }
    const kept: Record<string, PermissionAction> = {};
    for (const [pattern, action] of Object.entries(rules)) {
      if (action !== "allow" || shadowingAsks(pattern).length === 0) {
        kept[pattern] = action;
        continue;
      }
      withheld.push(describeRule(category, pattern));
      if (pattern === CATCH_ALL_PATTERN) {
        kept[pattern] = "ask";
      }
    }
    result[category] = kept;
  }

  if (withheld.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel} has no "ask" tier there, so the allow rule(s) for ${withheld.join(", ")} were ` +
        `withheld (a catch-all '*' allow falls back to the tool's prompt): an ask rule covers the ` +
        `same inputs, and an allow kept beside it would auto-approve what the ask should prompt for.`,
    );
  }
  return result;
}
