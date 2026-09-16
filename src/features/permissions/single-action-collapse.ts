import type { PermissionAction } from "../../types/permissions.js";

/**
 * Strictness order shared by the tools whose permission model evaluates
 * `deny > ask > allow`. Used wherever several canonical rules have to fold
 * into one entry, so the strictest action always wins.
 */
export const PERMISSION_ACTION_PRIORITY: Record<PermissionAction, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

/**
 * Collapse a pattern map to the single action a tool can hold for a scope
 * that has no pattern matcher, using deny > ask > allow precedence.
 *
 * A map without a catch-all grants nothing to unmatched inputs, so an
 * implicit `ask` joins the candidates and a narrow allowlist can never widen
 * into a blanket allow. Returns `undefined` for an empty map; each caller
 * decides what an empty map means for its tool (e.g. emit nothing, or fall
 * back to `deny` when the tool's own default is allow).
 */
export function collapseRulesToSingleAction({
  rules,
}: {
  rules: Record<string, PermissionAction>;
}): PermissionAction | undefined {
  const actions = Object.values(rules);
  if (actions.length === 0) {
    return undefined;
  }
  const candidates: PermissionAction[] = Object.hasOwn(rules, "*") ? actions : [...actions, "ask"];
  return candidates.reduce((current, candidate) =>
    PERMISSION_ACTION_PRIORITY[candidate] > PERMISSION_ACTION_PRIORITY[current]
      ? candidate
      : current,
  );
}

/**
 * Whether a pattern map carries anything beyond the `*` catch-all, i.e.
 * whether collapsing it to a single action loses information worth a warning.
 */
export function hasPatternSpecificRules(rules: Record<string, PermissionAction>): boolean {
  return Object.keys(rules).some((pattern) => pattern !== "*");
}
