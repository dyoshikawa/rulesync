import type { PermissionAction } from "../../types/permissions.js";
import { parseGlobPattern } from "../../utils/glob.js";
import type { Logger } from "../../utils/logger.js";
import { BRACE_ALTERNATIVES, toAntigravityCommandTarget } from "./antigravity-command-patterns.js";

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
 * - `command` takes literal words or a per-word `regex:`, matched word by
 *   word (see `antigravity-command-patterns.ts`).
 *
 * A glob copied verbatim (`read_file(**\/*.env)`) is a literal path that
 * matches nothing, so a deny written that way blocks nothing. A pattern with
 * no Antigravity spelling is skipped with a warning instead.
 *
 * @see https://antigravity.google/docs/permissions?tab=cli
 */

const PATH_ACTIONS = new Set(["read_file", "write_file"]);

// Every path the engine sees, written as a glob.
const MATCH_ALL_PATH_GLOBS = new Set(["*", "**", "**/*"]);

// A trailing glob that means "everything under this directory".
const DIRECTORY_CONTENTS_SUFFIX = /\/\*\*(?:\/\*)?$/;

// Hostnames as Antigravity matches them: letters, digits, dots and hyphens.
const HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

// What to deny instead when a deny pattern has no Antigravity spelling.
const DENY_HINTS: Record<string, string> = {
  read_file: "deny a directory or file path instead",
  write_file: "deny a directory or file path instead",
  command: "deny the first words of the command instead",
};

type TargetResult = { target: string; note?: string } | { skipReason: string };

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
  if (action === "command") {
    return toAntigravityCommandTarget(pattern);
  }
  if (PATH_ACTIONS.has(action)) {
    return toPathTarget(pattern);
  }
  if (action === "read_url") {
    return toUrlTarget(pattern);
  }
  return { target: pattern };
}

/**
 * Build the entry for one canonical rule, or return `undefined` when
 * Antigravity cannot express it. A skipped deny is warned about loudly,
 * because nothing enforces it.
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
    const consequence =
      decision === "deny"
        ? `This deny is NOT enforced in ${toolLabel}; ${DENY_HINTS[action] ?? "write it in a form Antigravity can match"}`
        : `${toolLabel} falls back to its default for it`;
    logger.warn(
      `${toolLabel} permissions: skipping ${rule}. ${result.skipReason}. ${consequence}.`,
    );
    return undefined;
  }
  // A wider allow or ask grants more than the rule asked for, so say so. A
  // wider deny only blocks more.
  if (result.note !== undefined && decision !== "deny") {
    logger.warn(`${toolLabel} permissions: ${rule}: ${result.note}.`);
  }
  return result.target === "*" ? action : `${action}(${result.target})`;
}
