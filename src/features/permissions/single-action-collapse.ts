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

/**
 * Whether a pattern map restricts (`deny` or `ask`) any input narrower than
 * its `*` catch-all.
 */
function restrictsNarrowerPatterns(rules: Record<string, PermissionAction> | undefined): boolean {
  return Object.entries(rules ?? {}).some(
    ([pattern, action]) => pattern !== "*" && action !== "allow",
  );
}

/**
 * The action a tool that lists whole tools (no pattern matcher) can hold for a
 * category's `*` catch-all once its pattern-level rules are dropped.
 *
 * A catch-all `allow` beside a narrower `deny` or `ask` would auto-approve the
 * very input that rule restricts, so it is downgraded to `ask`: the tool then
 * prompts for everything in the category, which is the closest the whole-tool
 * surface gets without blocking the inputs the author allowed. A narrower
 * restriction written under the all-tools `*` category (`allToolsRules`)
 * covers every category too, so it downgrades the allow as well. A catch-all
 * `ask` or `deny` already restricts at least as much and is kept. Returns
 * `undefined` when the category has no catch-all, and `downgraded: true` when
 * the allow was turned into `ask`, so the caller can say so in its warning.
 */
export function failSafeCatchAllAction({
  rules,
  allToolsRules,
}: {
  rules: Record<string, PermissionAction>;
  allToolsRules?: Record<string, PermissionAction> | undefined;
}): {
  action: PermissionAction | undefined;
  downgraded: boolean;
} {
  const catchAll = Object.hasOwn(rules, "*") ? rules["*"] : undefined;
  if (catchAll !== "allow") {
    return { action: catchAll, downgraded: false };
  }
  return restrictsNarrowerPatterns(rules) || restrictsNarrowerPatterns(allToolsRules)
    ? { action: "ask", downgraded: true }
    : { action: "allow", downgraded: false };
}
