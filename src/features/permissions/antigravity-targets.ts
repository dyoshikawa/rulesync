import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { parseGlobPattern } from "../../utils/glob.js";
import type { Logger } from "../../utils/logger.js";
import { getOrCreateOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import {
  ANTIGRAVITY_COMMAND_ACTIONS as COMMAND_ACTIONS,
  BRACE_ALTERNATIVES,
  type CommandTargetResult as TargetResult,
  importAntigravityCommandTarget,
  toAntigravityCommandLiteralPrefix,
  toAntigravityCommandTarget,
} from "./antigravity-command-patterns.js";
import { honorAllToolsOnBash, MCP_CATEGORY_PREFIX } from "./shell-command-categories.js";
import { parseToolPatternEntry } from "./tool-pattern-entry.js";

/**
 * Build Antigravity `action(target)` permission entries from canonical rules,
 * shared by the Antigravity CLI and IDE generators (one permissions engine).
 *
 * Canonical patterns are globs, but no Antigravity target is:
 *
 * - `read_file` / `write_file` take a path, absolute or relative to the
 *   workspace root. A directory covers everything inside it, and `*` covers
 *   every file.
 * - `read_url` takes a domain and covers its subdomains. The URL path is
 *   ignored, and `*` covers every domain.
 * - `execute_url` takes a domain, like `read_url`.
 * - `command` and `unsandboxed` take literal words or a per-word `regex:`,
 *   matched word by word (see `antigravity-command-patterns.ts`).
 * - `mcp` takes `server/tool` or `server/*`, matched exactly. A canonical
 *   `mcp__<server>__<tool>` category is written as that target.
 *
 * A glob copied verbatim (`read_file(**\/*.env)`) is a literal path that
 * matches nothing, so a deny written that way blocks nothing. A pattern with
 * no Antigravity spelling is skipped with a warning instead, except a deny
 * with a literal lead (the first words of a command, the leading directories
 * of a path), which is widened to it.
 *
 * @see https://antigravity.google/docs/permissions?tab=cli
 */

const PATH_ACTIONS = new Set(["read_file", "write_file"]);

// Actions whose target is a domain.
const URL_ACTIONS = new Set(["read_url", "execute_url"]);

// Every path the engine sees, written as a glob.
const MATCH_ALL_PATH_GLOBS = new Set(["*", "**", "**/*"]);

// A trailing glob that means "everything under this directory".
const DIRECTORY_CONTENTS_SUFFIX = /\/\*\*(?:\/\*)?$/;

// A path that is `~` or starts with `~/` or a `$NAME` variable, or holds a
// `${NAME}` reference. A `$` or `~` elsewhere is an ordinary file name
// character (`routes/posts.$postId.tsx`, `~$report.docx`).
const HOME_OR_VARIABLE_PATH = /^~(?:\/|$)|^\$[A-Za-z_]|\$\{[A-Za-z_]/;

// A path that is the home directory itself or starts in it, written with `~`.
const LEADING_HOME = /^~(?:\/|$)/;

/**
 * The home directory as an Antigravity path: forward slashes, no trailing
 * slash. agy accepts `C:/Users/...` on Windows, so one spelling serves both.
 */
function toAntigravityHomePath(homeDirectory: string): string {
  return homeDirectory.replaceAll("\\", "/").replace(/\/+$/, "");
}

/**
 * Rewrite a leading `~` or `~/` of a path target to the absolute home
 * directory. agy 1.5.1 matches `~` literally, so a `~/...` rule would never
 * apply (rulesync#3324). Only a file the user's own home holds, such as the
 * global Antigravity CLI settings, may carry a machine-specific path, so the
 * caller passes `homeDirectory` only then. `$HOME`, `${HOME}`, `%VAR%` and
 * `~user/` are left as written (the variable forms are still warned about).
 */
function expandLeadingHome(target: string, homeDirectory: string | undefined): string {
  if (homeDirectory === undefined || !LEADING_HOME.test(target)) {
    return target;
  }
  const home = toAntigravityHomePath(homeDirectory);
  return target === "~" ? home || "/" : `${home}${target.slice(1)}`;
}

/**
 * The reverse of {@link expandLeadingHome} on import: an absolute path in the
 * home directory goes back to `~/...`, so `.rulesync/permissions.jsonc` stays
 * the same on every machine.
 */
function collapseLeadingHome(target: string, homeDirectory: string | undefined): string {
  if (homeDirectory === undefined) {
    return target;
  }
  const home = toAntigravityHomePath(homeDirectory);
  if (home.length === 0) {
    return target;
  }
  if (target === home) {
    return "~";
  }
  return target.startsWith(`${home}/`) ? `~${target.slice(home.length)}` : target;
}

// Hostnames as Antigravity matches them: letters, digits, dots and hyphens.
const HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

// What to deny instead when a deny pattern has no Antigravity spelling.
const DENY_HINTS: Record<string, string> = {
  read_file: "deny a directory or file path instead",
  write_file: "deny a directory or file path instead",
  command: "deny the first words of the command instead",
  unsandboxed: "deny the first words of the command instead",
  mcp: "deny the whole MCP server or tool instead",
};

// `{a,b}` is not a glob step in `parseGlobPattern`, but it is one in every tool
// that reads canonical patterns, so it counts as a glob here.
function hasGlob(pattern: string): boolean {
  return (
    BRACE_ALTERNATIVES.test(pattern) ||
    parseGlobPattern(pattern).steps.some((step) => step.kind !== "literal")
  );
}

/**
 * A plain path stays as written, and `dir/**` becomes `dir`, which already
 * covers everything inside it. `*` is the bare action.
 */
function toPathTarget(pattern: string): TargetResult {
  // Checked before `./` is stripped, so `./*` (the root's own files) is not
  // read as every path.
  if (MATCH_ALL_PATH_GLOBS.has(pattern)) {
    return { target: "*" };
  }
  const path = pattern.startsWith("./") ? pattern.slice(2) : pattern;
  // `./`, `.` and `./**` name the workspace root, which covers all inside it.
  if (["", ".", "**", "**/*"].includes(path)) {
    return { target: "." };
  }
  // `/**` leaves an empty directory, which is the filesystem root, and `C:/**`
  // leaves `C:`, the drive's current directory rather than its root.
  const stripped = path.replace(DIRECTORY_CONTENTS_SUFFIX, "");
  const directory =
    stripped === "" && path.startsWith("/")
      ? "/"
      : /^[A-Za-z]:$/.test(stripped) && stripped !== path
        ? `${stripped}/`
        : stripped;
  if (directory !== path && directory.length > 0 && !hasGlob(directory)) {
    return { target: directory };
  }
  if (!hasGlob(path)) {
    return { target: path };
  }
  return {
    skipReason:
      "Antigravity file targets are paths, not globs. Only a plain path, `dir/**` or `*` can be expressed",
  };
}

/**
 * The canonical patterns a `read_file` / `write_file` target imports as. A
 * target can name a file or a directory, and a directory covers everything
 * inside it, but the target alone does not say which. A plain path such as
 * `src` imports as both `src` and `src/**`, so re-exporting it to a tool whose
 * plain path matches only that one path keeps covering the subtree; regenerating
 * collapses both back into one target. The bare `*`, and a target that already
 * holds glob characters (verbatim output of an older Rulesync), stay as written.
 */
function fromPathTarget(target: string): string[] {
  if (target === "*" || hasGlob(target)) {
    return [target];
  }
  // `./**`, not `**`: generation turns `**` into the bare action (every path).
  if (target === ".") {
    return [".", "./**"];
  }
  // A filesystem or drive root keeps its slash: `C:` alone is the drive's
  // current directory, not its root.
  const root = /^((?:[A-Za-z]:)?\/)\/*$/.exec(target)?.[1];
  if (root !== undefined) {
    return [root, `${root}**`];
  }
  // A trailing slash is dropped, so both patterns generate the same target.
  const path = target.replace(/\/+$/, "");
  return [path, `${path}/**`];
}

/**
 * A URL or domain pattern becomes its hostname. A leading `*.` is dropped,
 * since a domain already covers its subdomains, and the URL path is ignored.
 * Claude Code's `domain:` form is read as well.
 */
function toUrlTarget(pattern: string): TargetResult {
  const withoutPrefix = pattern.startsWith("domain:") ? pattern.slice("domain:".length) : pattern;
  if (withoutPrefix === "*") {
    return { target: "*" };
  }
  const withoutScheme = withoutPrefix.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // The authority ends at the path, the query or the fragment.
  const authorityEnd = withoutScheme.search(/[/?#]/);
  const authority = authorityEnd === -1 ? withoutScheme : withoutScheme.slice(0, authorityEnd);
  const host = authority
    .replace(/^[^@]*@/, "")
    .replace(/:\d+$/, "")
    .replace(/^\*\./, "")
    .toLowerCase();
  // `https://*` names every host. The bare action also covers other schemes.
  // With a path (`https://*/x`) it would turn into every URL, so it is skipped.
  const path = authorityEnd === -1 ? "" : withoutScheme.slice(authorityEnd);
  if (host === "*" && ["", "/", "/*", "/**"].includes(path)) {
    return { target: "*", note: "Antigravity matches by domain, so it covers every URL" };
  }
  if (!HOSTNAME.test(host)) {
    return {
      skipReason: "Antigravity URL targets are domains. No hostname could be read from it",
    };
  }
  // A domain target always covers the domain itself, every path on it and its
  // subdomains, which is more than any URL pattern but `*`. `*.example.com`
  // leaves out `example.com` itself, so it widens too.
  return {
    target: host,
    note: `Antigravity matches by domain, so it covers all of ${host} and its subdomains`,
  };
}

function toTarget(action: string, pattern: string): TargetResult {
  if (COMMAND_ACTIONS.has(action)) {
    return toAntigravityCommandTarget(pattern);
  }
  if (PATH_ACTIONS.has(action)) {
    return toPathTarget(pattern);
  }
  if (URL_ACTIONS.has(action)) {
    return toUrlTarget(pattern);
  }
  return { target: pattern };
}

// Characters that would change how Antigravity reads `mcp(server/tool)`.
const MCP_TARGET_SEPARATORS = /[/()]/;

/**
 * The `mcp` target of a canonical `mcp__<server>__<tool>` category:
 * `<server>/<tool>`, `<server>/*` for a whole server (`mcp__<server>`,
 * `mcp__<server>__*`), or `*` for every MCP tool (`mcp__*`, `mcp__*__*`). The
 * server ends at the first `__`, as elsewhere in rulesync. Antigravity matches
 * names exactly, so a glob, an empty name, or a `/` or parenthesis in a name
 * has no target; when only the tool part is at fault, its server is the `lead`
 * a deny widens to.
 */
function toMcpTarget(category: string): TargetResult & { lead?: string } {
  const remainder = category.slice(MCP_CATEGORY_PREFIX.length);
  const separator = remainder.indexOf("__");
  const server = separator === -1 ? remainder : remainder.slice(0, separator);
  const tool = separator === -1 ? "*" : remainder.slice(separator + 2);
  if (server === "*" && tool === "*") {
    return { target: "*" };
  }
  const skipReason =
    "Antigravity MCP targets name one server or one tool exactly. Only `mcp__<server>`, `mcp__<server>__*`, `mcp__<server>__<tool>` or `mcp__*` can be expressed";
  if (server.length === 0 || MCP_TARGET_SEPARATORS.test(server) || hasGlob(server)) {
    return { skipReason };
  }
  if (tool === "*") {
    return { target: `${server}/*` };
  }
  return tool.length === 0 || MCP_TARGET_SEPARATORS.test(tool) || hasGlob(tool)
    ? { skipReason, lead: `${server}/*` }
    : { target: `${server}/${tool}` };
}

/** The target of a canonical `mcp__...` rule, with the `lead` a deny widens to. */
function toMcpRuleTarget(category: string, pattern: string): TargetResult & { lead?: string } {
  const target = toMcpTarget(category);
  if (pattern === "*" || !("target" in target)) {
    return target;
  }
  return {
    skipReason: "Antigravity MCP targets name a server or a tool, not the tool's arguments",
    lead: target.target,
  };
}

/**
 * The leading directories of a path glob (`src` for `src/*.ts`), or
 * `undefined` when it has none. A directory target covers everything inside
 * it, so it matches at least as much as the glob. The filesystem root alone
 * (`/*`) is not a lead: a deny of it would block every file. Neither is a lead
 * with `..` in it.
 */
function toPathLiteralPrefix(pattern: string): string | undefined {
  const path = pattern.startsWith("./") ? pattern.slice(2) : pattern;
  const prefix: string[] = [];
  for (const segment of path.split("/").slice(0, -1)) {
    // A brace may be part of `{a,b/c}` alternatives, so it ends the lead.
    if (hasGlob(segment) || segment.includes("{") || segment.includes("}")) {
      break;
    }
    prefix.push(segment);
  }
  // A `..` anywhere in the lead leaves the workspace or steps back out of a
  // directory (`src/../*.env` is the root's files, not `src`), so the lead
  // would not cover the glob, or would cover the whole workspace and more.
  if (prefix.includes("..") || prefix.every((segment) => segment === "" || segment === ".")) {
    return undefined;
  }
  return prefix.join("/");
}

/** The widened target of a deny that has no exact Antigravity spelling. */
function toWidenedDenyTarget(action: string, pattern: string): string | undefined {
  if (COMMAND_ACTIONS.has(action)) {
    return toAntigravityCommandLiteralPrefix(pattern);
  }
  if (PATH_ACTIONS.has(action)) {
    return toPathLiteralPrefix(pattern);
  }
  return undefined;
}

/** The entry a deny is widened to, and what it now blocks. */
function describeWidenedDeny({
  action,
  prefix,
  isMcp,
}: {
  action: string;
  prefix: string;
  isMcp: boolean;
}): { entry: string; scope: string } {
  if (isMcp) {
    // `*` names every MCP tool, which the bare action already says.
    return prefix === "*"
      ? { entry: action, scope: "every MCP tool" }
      : { entry: `${action}(${prefix})`, scope: `every call of \`${action}(${prefix})\`` };
  }
  return {
    entry: `${action}(${prefix})`,
    scope: PATH_ACTIONS.has(action)
      ? `every path under \`${prefix}\``
      : `every command that starts with \`${prefix}\``,
  };
}

/**
 * Warn about a path target that is a home or variable reference. Antigravity
 * documents absolute and workspace-relative paths only, so such a reference
 * may be matched literally and never apply. The entry is still written, since
 * dropping a deny would lose it where Antigravity does expand the reference.
 */
function warnHomeOrVariablePath({
  action,
  target,
  rule,
  decision,
  logger,
  toolLabel,
}: {
  action: string;
  target: string;
  rule: string;
  decision: PermissionAction;
  logger: Logger;
  toolLabel: string;
}): void {
  if (!PATH_ACTIONS.has(action) || !HOME_OR_VARIABLE_PATH.test(target)) {
    return;
  }
  const consequence =
    decision === "deny"
      ? "this deny may block nothing"
      : decision === "ask"
        ? `${toolLabel} may fall back to its default, so it may run without a prompt when ${toolLabel} is set to always proceed`
        : `${toolLabel} may fall back to its default`;
  logger.warn(
    `${toolLabel} permissions: ${rule}: \`~\` and environment variables may not be expanded in Antigravity path targets, so ${action}(${target}) may match nothing and ${consequence}; use an absolute path instead.`,
  );
}

/**
 * Build the entry for one canonical rule, or return `undefined` when
 * Antigravity cannot express it. A deny is widened to its literal lead rather
 * than skipped (`git push * --force` → `command(git push)`, `src/*.ts` →
 * `read_file(src)`): Antigravity applies deny over ask and allow, so an
 * overlapping allow that is translated (`git push *`) cannot let through what
 * the deny was meant to block. A skipped deny is warned about loudly, because
 * nothing enforces it, and a widened one is warned about too, because it
 * blocks more than it says.
 */
export function buildAntigravityPermissionEntry({
  action: toolAction,
  category,
  pattern,
  decision,
  logger,
  toolLabel,
  homeDirectory,
}: {
  action: string;
  category: string;
  pattern: string;
  decision: PermissionAction;
  logger: Logger;
  toolLabel: string;
  /**
   * When set, a path target starting with `~/` (or exactly `~`) is written
   * with this absolute home directory instead.
   */
  homeDirectory?: string;
}): string | undefined {
  const isMcp = category.startsWith(MCP_CATEGORY_PREFIX);
  const action = isMcp ? "mcp" : toolAction;
  const result: TargetResult & { lead?: string } = isMcp
    ? toMcpRuleTarget(category, pattern)
    : pattern === "*"
      ? { target: "*" }
      : toTarget(action, pattern);
  const rule = `${category}: { "${pattern}": "${decision}" }`;
  if ("skipReason" in result) {
    const lead =
      decision !== "deny" ? undefined : isMcp ? result.lead : toWidenedDenyTarget(action, pattern);
    const prefix =
      lead !== undefined && PATH_ACTIONS.has(action)
        ? expandLeadingHome(lead, homeDirectory)
        : lead;
    if (prefix !== undefined) {
      const { entry, scope } = describeWidenedDeny({ action, prefix, isMcp });
      logger.warn(
        `${toolLabel} permissions: widening ${rule} to ${entry}. ${result.skipReason}. The deny now blocks ${scope}, overriding any allow or ask for them.`,
      );
      warnHomeOrVariablePath({ action, target: prefix, rule, decision, logger, toolLabel });
      return entry;
    }
    const consequence =
      decision === "deny"
        ? `This deny is NOT enforced in ${toolLabel}; ${DENY_HINTS[action] ?? "write it in a form Antigravity can match"}`
        : decision === "ask"
          ? `${toolLabel} falls back to its default for it, so it runs without a prompt when ${toolLabel} is set to always proceed`
          : `${toolLabel} falls back to its default for it`;
    logger.warn(
      `${toolLabel} permissions: skipping ${rule}. ${result.skipReason}. ${consequence}.`,
    );
    return undefined;
  }
  // A wider allow or ask grants more than the rule asked for, so say so. A
  // wider command deny only blocks the same command with more words, which is
  // what such a deny means. A URL deny widens to the whole domain, which also
  // overrides an allow or ask elsewhere on it (a deny of
  // `https://github.com/evil/*` blocks an allow of `https://github.com/*`).
  if (result.note !== undefined && (decision !== "deny" || URL_ACTIONS.has(action))) {
    const consequence =
      decision === "deny" ? ", so the deny also overrides any allow or ask there" : "";
    logger.warn(`${toolLabel} permissions: ${rule}: ${result.note}${consequence}.`);
  }
  const target = PATH_ACTIONS.has(action)
    ? expandLeadingHome(result.target, homeDirectory)
    : result.target;
  warnHomeOrVariablePath({ action, target, rule, decision, logger, toolLabel });
  return target === "*" ? action : `${action}(${target})`;
}

/**
 * Convert rulesync permissions config to Antigravity allow/ask/deny arrays,
 * shared by the CLI and IDE generators; `toAction` maps a canonical category to
 * the target's tool or action name.
 */
export function convertRulesyncToAntigravityPermissions({
  config,
  toAction,
  toolLabel,
  logger,
  homeDirectory,
}: {
  config: PermissionsConfig;
  toAction: (category: string) => string;
  toolLabel: string;
  logger: Logger;
  /** See {@link buildAntigravityPermissionEntry}. */
  homeDirectory?: string;
}): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    const action = toAction(category);
    for (const [pattern, permissionAction] of Object.entries(rules)) {
      const entry = buildAntigravityPermissionEntry({
        action,
        category,
        pattern,
        decision: permissionAction,
        logger,
        toolLabel,
        homeDirectory,
      });
      if (entry === undefined) {
        continue;
      }
      switch (permissionAction) {
        case "allow":
          allow.push(entry);
          break;
        case "ask":
          ask.push(entry);
          break;
        case "deny":
          deny.push(entry);
          break;
      }
    }
  }

  // Two patterns can translate to the same entry (`npm run *` and
  // `npm   run *`, or two denies widened to the same words), so drop repeats.
  return { allow: [...new Set(allow)], ask: [...new Set(ask)], deny: [...new Set(deny)] };
}

/**
 * Convert Antigravity allow/ask/deny arrays to rulesync permissions config,
 * shared by the CLI and IDE adapters; `toCategory` maps the target's tool or
 * action name back to a canonical category.
 */
export function convertAntigravityToRulesyncPermissions({
  allow,
  ask,
  deny,
  toCategory,
  toolLabel,
  logger,
  homeDirectory,
}: {
  allow: string[];
  ask: string[];
  deny: string[];
  toCategory: (action: string) => string;
  toolLabel: string;
  logger: Logger;
  /**
   * When set, a path target in this home directory is imported as `~/...`,
   * undoing the rewrite of {@link convertRulesyncToAntigravityPermissions}.
   */
  homeDirectory?: string;
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { toolName, pattern: target } = parseToolPatternEntry(entry);
      const canonical = toCategory(toolName);
      const patterns = COMMAND_ACTIONS.has(toolName)
        ? [
            importAntigravityCommandTarget({
              target,
              entry,
              decision: action,
              logger,
              toolLabel,
            }),
          ]
        : PATH_ACTIONS.has(toolName)
          ? fromPathTarget(collapseLeadingHome(target, homeDirectory))
          : [target];
      for (const pattern of patterns) {
        // A `__proto__` or `constructor` name would not land as a plain own
        // key, so such entries are dropped, as the other permissions adapters do.
        if (isPrototypePollutionKey(canonical) || isPrototypePollutionKey(pattern)) {
          continue;
        }
        getOrCreateOwn({ record: permission, key: canonical, create: () => ({}) })[pattern] =
          action;
      }
    }
  };

  processEntries(allow, "allow");
  processEntries(ask, "ask");
  processEntries(deny, "deny");

  return { permission };
}
