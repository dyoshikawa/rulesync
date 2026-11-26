import { isDeepStrictEqual } from "node:util";

import type { PermissionAction } from "../../types/permissions.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  CATCH_ALL_PATTERN,
  createShadowingRestrictionsTest,
} from "./shell-command-categories.js";
import { isStricterAction, sortRulesByActionPriority } from "./single-action-collapse.js";

/**
 * OpenCode (and its forks: Kilo, MiMo Code) applies the last matching rule,
 * and the `*` key comes first in the usual file, so a later key's allow overrides a pattern-specific `*` deny or
 * ask: `{"*": {".env": "deny"}, "read": {"*": "allow"}}` would read `.env`
 * freely. Canonically the stricter rule wins whatever its width, so each such
 * restriction is restated at the end of every other key that holds a looser
 * rule it overlaps, where it is matched after that rule. A `*` catch-all
 * (`{"*": {"*": "ask"}}` followed by per-tool allows) is the documented way to
 * set an OpenCode default, so it is not restated in the later keys.
 *
 * The `*` key's own patterns are reordered allow, then ask, then deny, so the
 * strictest matching one wins there too. This disables an allow carve-out
 * under a broader ask or deny in that key (`{"*": "deny", "src/**": "allow"}`
 * denies `src/**` as well), so a warning is logged whenever the order changes,
 * unless `<target>.permission["*"]` (`allToolsOverridden`) replaces the key
 * with an exact order anyway.
 *
 * A restated rule must never land after an overlapping stricter one, or it
 * would loosen what that rule says. The tail of a key is therefore written
 * asks first, then denies: every restated ask, then each of the key's own
 * denies and each `*` deny that overlaps one of those asks (moved after them),
 * then the restated `*` denies. A key whose own catch-all is a deny covers
 * every input of a restated ask already, so such an ask is restated as a deny.
 */
export function restateAllToolsRestrictionsLast({
  sharedPermission,
  toolTarget,
  allToolsOverridden = false,
  logger,
}: {
  sharedPermission: Record<string, Record<string, PermissionAction>>;
  toolTarget: string;
  /** Whether `<target>.permission["*"]` replaces the `*` key after this step. */
  allToolsOverridden?: boolean;
  logger?: Logger;
}): Record<string, Record<string, PermissionAction>> {
  const allToolsRules = Object.hasOwn(sharedPermission, ALL_TOOLS_PERMISSION_CATEGORY)
    ? sharedPermission[ALL_TOOLS_PERMISSION_CATEGORY]
    : undefined;
  const restrictions = Object.entries(allToolsRules ?? {}).filter(
    ([pattern, action]) =>
      action !== "allow" && pattern !== CATCH_ALL_PATTERN && !isPrototypePollutionKey(pattern),
  );
  const globsOverlap = createGlobsOverlap();
  const result: Record<string, Record<string, PermissionAction>> = {};
  const respelled: string[] = [];
  for (const [key, rules] of Object.entries(sharedPermission)) {
    let written: Record<string, PermissionAction>;
    if (key !== ALL_TOOLS_PERMISSION_CATEGORY) {
      written = restateInKey({ rules, restrictions, globsOverlap });
    } else {
      written = sortRulesByActionPriority(rules);
      if (!allToolsOverridden && !isDeepStrictEqual(Object.keys(written), Object.keys(rules))) {
        logger?.warn(
          `The all-tools "*" permission patterns were reordered allow, ask, deny because ${toolTarget} applies the last matching pattern and the stricter rule must win, which may disable a looser carve-out under a broader ask or deny pattern (e.g. "*": "deny", "src/**": "allow"). Set ${toolTarget}.permission["*"] to control the exact order.`,
        );
      }
    }
    if (key === ALL_TOOLS_PERMISSION_CATEGORY && allToolsOverridden) {
      result[key] = written;
      continue;
    }
    const moved = respellIntegerLikeRestrictions({ rules: written, globsOverlap });
    for (const pattern of moved.respelled) respelled.push(`${key}: ${pattern}`);
    result[key] = moved.rules;
  }
  if (respelled.length > 0) {
    logger?.warn(
      `${toolTarget} reads permission patterns in object order, where an integer-like key always comes first, so a looser rule after it would override it. The deny/ask pattern(s) ${respelled.join(", ")} were written with a trailing "*" at the end of their key instead, which also covers the inputs that merely start with them.`,
    );
  }
  return result;
}

/**
 * Whether two globs can name one input, with the left side's parsed test
 * built once per distinct pattern rather than once per pair.
 */
function createGlobsOverlap(): (left: string, right: string) => boolean {
  const tests = new Map<string, (allowPattern: string) => string[]>();
  return (left, right) => {
    let test = tests.get(left);
    if (test === undefined) {
      test = createShadowingRestrictionsTest([{ pattern: left, fromAllToolsCategory: true }]);
      tests.set(left, test);
    }
    return test(right).length > 0;
  };
}

/** An array-index-like key, which JavaScript (and so JSON) objects list before every other key. */
function isIntegerLikeKey(key: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < 2 ** 32 - 1;
}

/**
 * One key's rules with every integer-like deny or ask pattern (`8080`) that a
 * looser rule after it overlaps written as `<pattern>*` at the key's end.
 *
 * An integer-like key cannot be placed anywhere but first in a JSON object, as
 * written by rulesync and as read back by the tool, so a looser rule later in
 * the key would override it under last-match-wins. `8080*` is no longer
 * integer-like, keeps its place, and covers `8080` (and the inputs starting
 * with it, a wider restriction, never a wider allow). The tail follows the
 * same order as a restated `*` restriction: asks first, then denies, with
 * every deny that overlaps a moved ask moved after it, so a moved ask never
 * lands after a stricter rule it overlaps.
 */
function respellIntegerLikeRestrictions({
  rules,
  globsOverlap,
}: {
  rules: Record<string, PermissionAction>;
  globsOverlap: (left: string, right: string) => boolean;
}): { rules: Record<string, PermissionAction>; respelled: string[] } {
  const entries = Object.entries(rules);
  const respelled = entries
    .filter(
      ([pattern, action], index) =>
        action !== "allow" &&
        isIntegerLikeKey(pattern) &&
        entries
          .slice(index + 1)
          .some(
            ([later, laterAction]) =>
              isStricterAction({ action, existing: laterAction }) && globsOverlap(pattern, later),
          ),
    )
    .map(([pattern]) => pattern);
  if (respelled.length === 0) {
    return { rules, respelled };
  }
  const tail = new Map<string, PermissionAction>();
  const raise = (pattern: string, action: PermissionAction): void => {
    const existing =
      tail.get(pattern) ?? (Object.hasOwn(rules, pattern) ? rules[pattern] : undefined);
    tail.set(pattern, isStricterAction({ action, existing }) ? action : (existing ?? action));
  };
  for (const pattern of respelled) raise(`${pattern}*`, rules[pattern] ?? "deny");
  // The asks as written at the end, whose trailing `*` reaches further.
  const askPatterns = respelled
    .filter((pattern) => rules[pattern] === "ask")
    .map((pattern) => `${pattern}*`);
  const moved = new Set(respelled);
  for (const [pattern, action] of entries) {
    if (action !== "deny" || moved.has(pattern)) continue;
    if (!askPatterns.some((ask) => globsOverlap(pattern, ask))) continue;
    // An integer-like deny cannot move either, so it is respelled as well.
    if (isIntegerLikeKey(pattern)) {
      moved.add(pattern);
      respelled.push(pattern);
      raise(`${pattern}*`, action);
    } else {
      raise(pattern, action);
    }
  }
  const result: Record<string, PermissionAction> = {};
  for (const [pattern, action] of entries) {
    if (!moved.has(pattern) && !tail.has(pattern)) result[pattern] = action;
  }
  for (const [pattern, action] of tail) if (action === "ask") result[pattern] = action;
  for (const [pattern, action] of tail) if (action === "deny") result[pattern] = action;
  return { rules: result, respelled };
}

/** One key's rules with the `*` restrictions restated at its end; see the caller. */
function restateInKey({
  rules,
  restrictions,
  globsOverlap,
}: {
  rules: Record<string, PermissionAction>;
  restrictions: Array<[string, PermissionAction]>;
  globsOverlap: (left: string, right: string) => boolean;
}): Record<string, PermissionAction> {
  const own = Object.entries(rules);
  const ownAction = (pattern: string): PermissionAction | undefined =>
    Object.hasOwn(rules, pattern) ? rules[pattern] : undefined;
  const overlapsLooserOwnRule = (pattern: string, action: PermissionAction): boolean =>
    own.some(
      ([ownPattern, existing]) =>
        isStricterAction({ action, existing }) && globsOverlap(pattern, ownPattern),
    );
  const allToolsDenies = restrictions
    .filter(([, action]) => action === "deny")
    .map(([pattern]) => pattern);
  let asks = restrictions
    .filter(([pattern, action]) => action === "ask" && overlapsLooserOwnRule(pattern, action))
    .map(([pattern]) => pattern);
  const denies = new Set(
    allToolsDenies.filter((pattern) => overlapsLooserOwnRule(pattern, "deny")),
  );
  if (ownAction(CATCH_ALL_PATTERN) === "deny") {
    for (const pattern of asks) denies.add(pattern);
    asks = [];
  }
  // An own deny of the same spelling absorbs the ask, and is moved to the
  // tail like any deny the restated rules overlap, so the looser own rules
  // written after it (`{".env": "deny", "*": "allow"}`) cannot override it.
  for (const pattern of asks) {
    if (ownAction(pattern) === "deny") denies.add(pattern);
  }
  asks = asks.filter((pattern) => ownAction(pattern) !== "deny");
  const overlapsAnAsk = (pattern: string): boolean =>
    asks.some((ask) => globsOverlap(ask, pattern));
  const ownDenies = own
    .filter(([pattern, action]) => action === "deny" && pattern !== CATCH_ALL_PATTERN)
    .map(([pattern]) => pattern);
  for (const pattern of [...ownDenies, ...allToolsDenies]) {
    if (overlapsAnAsk(pattern)) denies.add(pattern);
  }
  if (asks.length === 0 && denies.size === 0) {
    return rules;
  }
  const tail = new Set([...asks, ...denies]);
  const restated: Record<string, PermissionAction> = {};
  for (const [pattern, action] of own) {
    if (!tail.has(pattern)) restated[pattern] = action;
  }
  for (const pattern of asks) restated[pattern] = "ask";
  for (const pattern of denies) restated[pattern] = "deny";
  return restated;
}
