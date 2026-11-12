import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { globsIntersect } from "../../utils/glob.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  bashRulesHonoringAllTools,
  CATCH_ALL_PATTERN,
  createShadowingRestrictionsTest,
  SHELL_PERMISSION_CATEGORY,
} from "./shell-command-categories.js";
import { isStricterAction } from "./single-action-collapse.js";

type Permission = PermissionsConfig["permission"];

/** The canonical category whose patterns are URLs or domains. */
const WEBFETCH_CATEGORY = "webfetch";

/**
 * A URL or domain pattern lowercased and without its scheme, so `HTTPS://Evil.example/*`
 * and `evil.example/*` are compared as the same host. Hosts are case-insensitive
 * and a scheme-less allow covers every scheme.
 */
export function normalizeUrlPattern(pattern: string): string {
  return pattern.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
}

/**
 * A URL pattern with its scheme stripped and only its host lowercased, for
 * writing it into a tool that matches paths case-sensitively (Copilot in VS
 * Code). A scheme spelled as a glob (a `*` scheme, `http*://`, or a bare double
 * slash after a `*` or at the start) is stripped too. A double slash after
 * anything else without a `:` is part of the path, so `evil.com//x` keeps its
 * host `evil.com`.
 */
export function stripUrlSchemeKeepingPathCase(pattern: string): string {
  return keepingPathCase(pattern.replace(/^(?:[a-z0-9+.*-]*:|\*)?\/\//i, ""));
}

/**
 * The reading `stripUrlSchemeKeepingPathCase` gave before it required a `:`,
 * which took any `<word>//` prefix for a scheme (`evil.com//x` became `x`).
 * Overlap checks compare this reading too, so requiring the `:` only ever
 * adds overlaps and never lets through an allow that was withheld before.
 */
function stripUrlSchemeLoosely(pattern: string): string {
  return keepingPathCase(pattern.replace(/^[a-z0-9+.*-]*:?\/\//i, ""));
}

/**
 * Whether a URL pattern has a `<word>//` prefix without a `:` (`evil.com//x`),
 * which an earlier reading took for a scheme. Such a pattern names a host
 * other than the one that reading gave, so a tool should not be handed a
 * rewritten form of it.
 */
export function hasDoubleSlashWithoutScheme(pattern: string): boolean {
  return stripUrlSchemeKeepingPathCase(pattern) !== stripUrlSchemeLoosely(pattern);
}

/** A scheme-less URL pattern with only its host lowercased. */
function keepingPathCase(withoutScheme: string): string {
  const slash = withoutScheme.indexOf("/");
  return slash === -1
    ? withoutScheme.toLowerCase()
    : `${withoutScheme.slice(0, slash).toLowerCase()}${withoutScheme.slice(slash)}`;
}

type UrlPatternParts = { host: string; port: string | undefined; path: string | undefined };

/** Split a scheme-less URL or domain pattern into lowercased host, port and path. */
function splitUrlPattern(withoutScheme: string): UrlPatternParts {
  const normalized = withoutScheme.toLowerCase();
  const slash = normalized.indexOf("/");
  const hostPort = slash === -1 ? normalized : normalized.slice(0, slash);
  const path = slash === -1 ? undefined : normalized.slice(slash);
  const port = /:([0-9*]+)$/.exec(hostPort);
  return port === null
    ? { host: hostPort, port: undefined, path }
    : { host: hostPort.slice(0, port.index), port: port[1], path };
}

/**
 * Whether two URL or domain patterns can name one URL. Both are compared
 * lowercased and without their scheme, part by part, so a `*` in one part
 * never reaches into another (`*.github.com` does not overlap
 * `example.org/private/*`). A pathless pattern is a host, which domain-only
 * tools read as every URL on it, on any port, and on its subdomains, so a
 * missing path or port matches every path or port, and each host also stands
 * for `*.<host>`. Because a glob can also match across those parts, the
 * whole strings are compared as well, a pathless `right` also as `<host>/*`
 * (so an allowed `example.com` overlaps a restricted `*.pdf`), and an overlap
 * from any of them counts. A pattern holding whitespace names no URL. Callers
 * pass the restriction as `left` and the allow as `right`.
 */
export function urlPatternsOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  // A URL holds no whitespace, so a pattern that does (a command such as
  // `rm -rf *`) names none.
  if (/\s/.test(left) || /\s/.test(right)) return false;
  return urlPartsOverlap(left, right) || wholeStringsOverlap(left, right);
}

/**
 * The whole-string comparison a `*` restriction also gets, since a glob there
 * matches the whole URL (`*.pdf` names `https://example.com/doc.pdf`): the two
 * patterns compared as written and lowercased without a scheme, each widened
 * by `createShadowingRestrictionsTest`. A pathless allow (`right`) is a host
 * and stands for every path on it, so against a restriction without a `/`
 * (`*.pdf`, `*admin`) it is also compared as `<host>/*`. A restriction with a
 * `/` names its host and path itself and is compared part by part instead, and
 * a pathless restriction is not widened: `.env/*` would reach every allow that
 * starts with a `*` (`*.github.com`), and `*://evil.com/*` against
 * `good.com/*` would match through the `*`.
 */
function wholeStringsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeUrlPattern(left);
  const normalizedRight = normalizeUrlPattern(right);
  return [
    [left, right],
    [normalizedLeft, normalizedRight],
    ...(normalizedLeft.includes("/") ? [] : [[normalizedLeft, withAnyPath(normalizedRight)]]),
  ].some(
    ([restriction = "", allow = ""]) =>
      createShadowingRestrictionsTest([{ pattern: restriction, fromAllToolsCategory: false }])(
        allow,
      ).length > 0,
  );
}

/** A scheme-less pattern with `/*` appended when it has no path. */
function withAnyPath(withoutScheme: string): string {
  return stripUrlSchemeKeepingPathCase(withoutScheme).includes("/")
    ? withoutScheme
    : `${withoutScheme}/*`;
}

function urlPartsOverlap(left: string, right: string): boolean {
  const readings = (pattern: string): UrlPatternParts[] =>
    [...new Set([stripUrlSchemeKeepingPathCase(pattern), stripUrlSchemeLoosely(pattern)])].map(
      splitUrlPattern,
    );
  return readings(left).some((a) => readings(right).some((b) => urlPartsPairOverlap(a, b)));
}

function urlPartsPairOverlap(a: UrlPatternParts, b: UrlPatternParts): boolean {
  const hosts = (host: string): string[] => [host, `*.${host}`];
  const hostsOverlap = hosts(a.host).some((x) => hosts(b.host).some((y) => globsIntersect(x, y)));
  if (!hostsOverlap) return false;
  if (a.port !== undefined && b.port !== undefined && !globsIntersect(a.port, b.port)) {
    return false;
  }
  return a.path === undefined || b.path === undefined || globsIntersect(a.path, b.path);
}

/**
 * Whether any of `restrictions` overlaps an allow pattern of `category`. For
 * `webfetch` the patterns are compared as URLs (see `urlPatternsOverlap`).
 */
function createCategoryShadowTest({
  restrictions,
  category,
}: {
  restrictions: readonly { pattern: string; fromAllToolsCategory: boolean }[];
  category: string;
}): (allowPattern: string) => boolean {
  if (category === WEBFETCH_CATEGORY) {
    return (allowPattern) =>
      restrictions.some(({ pattern }) => urlPatternsOverlap(pattern, allowPattern));
  }
  const asWritten = createShadowingRestrictionsTest(restrictions);
  return (allowPattern) => asWritten(allowPattern).length > 0;
}

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
 *   (AugmentCode instead applies its blanket all-tools fallback to a tool left
 *   with no entries, since its own default would auto-run the tool.) Width
 *   does not matter: a shell-only `{"*": {"git push *": "ask"}}` withholds a
 *   `read: {"*": "allow"}` too, because the catch-all names every input.
 * - With `dropAllToolsPatterns`, the pattern-specific entries of `*` itself are
 *   removed, for a tool that would otherwise write them as an inert literal
 *   `*(<pattern>)` rule. They are honored by the withholding above.
 *
 * `restateAs` says which pattern-specific `*` restrictions the tool can write
 * as a rule of the category itself (`Read(.env)`), for a tool whose default for
 * an input with no rule would auto-approve it: such a restriction is copied
 * into each stated category it applies to (see `restatesAsCategoryRule`), so
 * the input stays restricted after its allow is withheld.
 * `downgradeWithheldCatchAll` writes a withheld catch-all `*` allow as `ask`
 * (`deny` under a catch-all `*` deny) rather than dropping it, for a tool that keeps a stale `always` otherwise.
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
  restateAs = () => false,
  downgradeWithheldCatchAll = false,
}: {
  permission: Permission;
  toolLabel: string;
  logger?: Logger;
  writesAllToolsCatchAll?: boolean;
  dropAllToolsPatterns?: boolean;
  isCatchAll?: (pattern: string) => boolean;
  restateAs?: RestateAs;
  downgradeWithheldCatchAll?: boolean;
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
      // A withheld allow is either gone or replaced by the `*` rule of the
      // same spelling (`{"*": {"git push *": "ask"}, "bash": {"git push *":
      // "allow"}}` leaves an ask there); both are named.
      for (const [pattern, action] of Object.entries(rules)) {
        if (action === "allow" && bash[pattern] !== "allow") {
          withheld.push(describeRule(category, pattern));
        }
      }
      result[category] = bash;
      continue;
    }
    result[category] = honorInCategory({
      category,
      rules,
      restrictions: restrictions.map(({ pattern }) => ({
        pattern,
        action: allToolsRules[pattern] ?? "deny",
      })),
      restateAs,
      downgradeWithheldCatchAll,
      withheld,
    });
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

/** Which `*` restrictions a tool restates under a category; see `honorAllToolsRestrictions`. */
type RestateAs = (params: {
  category: string;
  pattern: string;
  action: PermissionAction;
}) => boolean;

/** File categories whose patterns are paths. */
const PATH_CATEGORIES = new Set(["read", "edit", "write"]);

/**
 * The common `restateAs`: a restriction is restated under a path category when
 * it reads as a path (no whitespace, so not a command such as `git push *`),
 * and under `webfetch` when it reads as a URL or domain. `actions` limits it to
 * the actions the tool can write per pattern.
 */
export function restatesAsCategoryRule(
  actions: readonly PermissionAction[] = ["deny", "ask"],
): RestateAs {
  return ({ category, pattern, action }) => {
    if (!actions.includes(action) || pattern === CATCH_ALL_PATTERN) return false;
    if (PATH_CATEGORIES.has(category)) return !/\s/.test(pattern);
    if (category === WEBFETCH_CATEGORY) {
      return /^([a-z][a-z0-9+.-]*:\/\/)?[\w*-]+(\.[\w*-]+)+(:[\w*]+)?(\/\S*)?$/i.test(pattern);
    }
    return false;
  };
}

/** One non-shell category with the `*` restrictions honored; see the caller. */
function honorInCategory({
  category,
  rules,
  restrictions,
  restateAs,
  downgradeWithheldCatchAll,
  withheld,
}: {
  category: string;
  rules: Record<string, PermissionAction>;
  restrictions: { pattern: string; action: PermissionAction }[];
  restateAs: RestateAs;
  downgradeWithheldCatchAll: boolean;
  withheld: string[];
}): Record<string, PermissionAction> {
  const shadowingRestrictions = createCategoryShadowTest({
    restrictions: restrictions.map(({ pattern }) => ({ pattern, fromAllToolsCategory: true })),
    category,
  });
  // A catch-all `*` deny covers every input, so the downgraded catch-all is a
  // deny then; any other restriction leaves the rest of the inputs to a prompt.
  const downgradedAction: PermissionAction = restrictions.some(
    ({ pattern, action }) => pattern === CATCH_ALL_PATTERN && action === "deny",
  )
    ? "deny"
    : "ask";
  const kept: Record<string, PermissionAction> = {};
  for (const [pattern, action] of Object.entries(rules)) {
    if (action === "allow" && shadowingRestrictions(pattern)) {
      withheld.push(describeRule(category, pattern));
      if (downgradeWithheldCatchAll && pattern === CATCH_ALL_PATTERN) {
        kept[pattern] = downgradedAction;
      }
      continue;
    }
    kept[pattern] = action;
  }
  return restateInCategory({ category, rules: kept, restrictions, restateAs });
}

function restateInCategory({
  category,
  rules,
  restrictions,
  restateAs,
}: {
  category: string;
  rules: Record<string, PermissionAction>;
  restrictions: { pattern: string; action: PermissionAction }[];
  restateAs: RestateAs;
}): Record<string, PermissionAction> {
  const restated = { ...rules };
  for (const { pattern, action } of restrictions) {
    if (isPrototypePollutionKey(pattern) || !restateAs({ category, pattern, action })) continue;
    const existing = Object.hasOwn(restated, pattern) ? restated[pattern] : undefined;
    if (isStricterAction({ action, existing })) {
      restated[pattern] = action;
    }
  }
  return restated;
}

/**
 * One category's rules with the pattern-specific `*` restrictions `restateAs`
 * accepts copied in as its own rules (the stricter action wins on a shared
 * spelling), for a tool that can write them there and needs no allow
 * withheld, because its own ordering already lets the copied rule win.
 */
export function restateAllToolsRestrictionsInCategory({
  permission,
  category,
  restateAs,
}: {
  permission: Permission;
  category: string;
  restateAs: RestateAs;
}): Record<string, PermissionAction> {
  const rules = lookupOwn({ record: permission, key: category }) ?? {};
  const allToolsRules = lookupOwn({ record: permission, key: ALL_TOOLS_PERMISSION_CATEGORY }) ?? {};
  return restateInCategory({
    category,
    rules,
    restrictions: Object.entries(allToolsRules)
      .filter(([, action]) => action !== "allow")
      .map(([pattern, action]) => ({ pattern, action })),
    restateAs,
  });
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

  const result: Permission = {};
  const withheld: string[] = [];
  for (const [category, rules] of Object.entries(permission)) {
    const asks = asksByGroup.get(groupOf(category));
    if (asks === undefined) {
      result[category] = rules;
      continue;
    }
    const shadowingAsks = createCategoryShadowTest({
      restrictions: asks.map((pattern) => ({ pattern, fromAllToolsCategory: false })),
      category,
    });
    const kept: Record<string, PermissionAction> = {};
    for (const [pattern, action] of Object.entries(rules)) {
      if (action !== "allow" || !shadowingAsks(pattern)) {
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
