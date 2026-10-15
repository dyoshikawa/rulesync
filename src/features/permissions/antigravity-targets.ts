import type { PermissionAction } from "../../types/permissions.js";
import { parseGlobPattern } from "../../utils/glob.js";
import type { Logger } from "../../utils/logger.js";
import {
  ANTIGRAVITY_COMMAND_ACTIONS as COMMAND_ACTIONS,
  BRACE_ALTERNATIVES,
  type CommandTargetResult as TargetResult,
  toAntigravityCommandLiteralPrefix,
  toAntigravityCommandTarget,
} from "./antigravity-command-patterns.js";

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

// Hostnames as Antigravity matches them: letters, digits, dots and hyphens.
const HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

// What to deny instead when a deny pattern has no Antigravity spelling.
const DENY_HINTS: Record<string, string> = {
  read_file: "deny a directory or file path instead",
  write_file: "deny a directory or file path instead",
  command: "deny the first words of the command instead",
  unsandboxed: "deny the first words of the command instead",
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
  // `/**` leaves an empty directory, which is the filesystem root.
  const directory =
    path.replace(DIRECTORY_CONTENTS_SUFFIX, "") || (path.startsWith("/") ? "/" : "");
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

/**
 * The leading directories of a path glob (`src` for `src/*.ts`), or
 * `undefined` when it has none. A directory target covers everything inside
 * it, so it matches at least as much as the glob. The filesystem root alone
 * (`/*`) is not a lead: a deny of it would block every file.
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
  if (prefix.every((segment) => segment === "" || segment === ".")) {
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
  action,
  category,
  pattern,
  decision,
  logger,
  toolLabel,
}: {
  action: string;
  category: string;
  pattern: string;
  decision: PermissionAction;
  logger: Logger;
  toolLabel: string;
}): string | undefined {
  const result = pattern === "*" ? { target: "*" } : toTarget(action, pattern);
  const rule = `${category}: { "${pattern}": "${decision}" }`;
  if ("skipReason" in result) {
    const prefix = decision === "deny" ? toWidenedDenyTarget(action, pattern) : undefined;
    if (prefix !== undefined) {
      const scope = PATH_ACTIONS.has(action)
        ? `every path under \`${prefix}\``
        : `every command that starts with \`${prefix}\``;
      logger.warn(
        `${toolLabel} permissions: widening ${rule} to ${action}(${prefix}). ${result.skipReason}. The deny now blocks ${scope}, overriding any allow or ask for them.`,
      );
      warnHomeOrVariablePath({ action, target: prefix, rule, decision, logger, toolLabel });
      return `${action}(${prefix})`;
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
  warnHomeOrVariablePath({ action, target: result.target, rule, decision, logger, toolLabel });
  return result.target === "*" ? action : `${action}(${result.target})`;
}
