import type { PermissionAction } from "../../types/permissions.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  CATCH_ALL_PATTERN,
  createShadowingRestrictionsTest,
} from "./shell-command-categories.js";
import { isStricterAction } from "./single-action-collapse.js";

/**
 * OpenCode (and its forks: Kilo, MiMo Code) applies the last matching rule,
 * and the `*` key comes first in the usual file, so a later key's allow overrides a pattern-specific `*` deny or
 * ask: `{"*": {".env": "deny"}, "read": {"*": "allow"}}` would read `.env`
 * freely. Canonically the stricter rule wins whatever its width, so each such
 * restriction is restated at the end of every other key that holds a looser
 * rule it overlaps, where it is matched after that rule. A `*` catch-all
 * (`{"*": {"*": "ask"}}` followed by per-tool allows) is the documented way to
 * set an OpenCode default, so it is left where it is.
 *
 * A restated rule must never land after an overlapping stricter one, or it
 * would loosen what that rule says. The tail of a key is therefore written
 * asks first, then denies: every restated ask, then each of the key's own
 * denies and each `*` deny that overlaps one of those asks (moved after them),
 * then the restated `*` denies. A key whose own catch-all is a deny covers
 * every input of a restated ask already, so such an ask is restated as a deny.
 */
export function restateAllToolsRestrictionsLast(
  sharedPermission: Record<string, Record<string, PermissionAction>>,
): Record<string, Record<string, PermissionAction>> {
  const allToolsRules = Object.hasOwn(sharedPermission, ALL_TOOLS_PERMISSION_CATEGORY)
    ? sharedPermission[ALL_TOOLS_PERMISSION_CATEGORY]
    : undefined;
  const restrictions = Object.entries(allToolsRules ?? {}).filter(
    ([pattern, action]) =>
      action !== "allow" && pattern !== CATCH_ALL_PATTERN && !isPrototypePollutionKey(pattern),
  );
  if (restrictions.length === 0) {
    return sharedPermission;
  }
  const result: Record<string, Record<string, PermissionAction>> = {};
  for (const [key, rules] of Object.entries(sharedPermission)) {
    result[key] =
      key === ALL_TOOLS_PERMISSION_CATEGORY ? rules : restateInKey({ rules, restrictions });
  }
  return result;
}

function globsOverlap(left: string, right: string): boolean {
  return (
    createShadowingRestrictionsTest([{ pattern: left, fromAllToolsCategory: true }])(right).length >
    0
  );
}

/** One key's rules with the `*` restrictions restated at its end; see the caller. */
function restateInKey({
  rules,
  restrictions,
}: {
  rules: Record<string, PermissionAction>;
  restrictions: Array<[string, PermissionAction]>;
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
