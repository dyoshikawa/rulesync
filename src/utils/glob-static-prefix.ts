import { posix } from "node:path";

/**
 * Characters that make a path segment a pattern rather than a literal name.
 *
 * `(` `)` and `!` are included because extglob syntax (`+(a|b)`, `!(x)`) uses
 * them; treating a segment that carries one as static could name a directory
 * that no matched file actually lives under.
 */
const GLOB_METACHARACTERS = /[*?[\]{}()!]/;

/**
 * The directory every file matched by `glob` lives under, or `undefined` when
 * the pattern pins down no such directory.
 *
 * The result is the longest leading run of POSIX path segments that contain no
 * glob metacharacter, minus the final segment when the pattern ends in one that
 * is static: `packages/api/**\/*.ts` yields `packages/api`, while
 * `packages/api/README.md` names a file and yields `packages/api` as well, and
 * a bare `README.md` yields nothing. A leading `./` is stripped. The following
 * patterns are rejected outright because the directory they would name is
 * either not inside the output root or not a single directory at all:
 *
 * - negation patterns (`!packages/**`), which exclude rather than select;
 * - absolute paths (`/etc/**`, `C:/x/**`) and backslash-separated patterns;
 * - patterns with a `..` segment anywhere;
 * - patterns with a brace expansion or any other metacharacter in their first
 *   segment (`{a,b}/**`), which have no static prefix.
 *
 * Brace expansion elsewhere ends the prefix without rejecting the pattern:
 * `packages/{api,web}/**` yields `packages`, the directory both alternatives
 * share, exactly as `packages/*\/**` would.
 */
export function getGlobStaticPrefix(glob: string): string | undefined {
  if (glob.startsWith("!") || glob.includes("\\")) {
    return undefined;
  }

  let pattern = glob;
  while (pattern.startsWith("./")) {
    pattern = pattern.slice(2);
  }
  if (pattern.startsWith("/") || /^[A-Za-z]:/.test(pattern)) {
    return undefined;
  }

  const segments = pattern.split("/");
  if (segments.includes("..")) {
    return undefined;
  }

  const lastIndex = segments.length - 1;
  const prefix: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment === "" || GLOB_METACHARACTERS.test(segment)) {
      // A trailing `/` closes the directory; an empty segment anywhere else
      // (`a//b`) is a malformed pattern nothing depends on, so it ends the
      // prefix as a wildcard would.
      break;
    }
    if (segment === ".") {
      continue;
    }
    if (index === lastIndex) {
      // A static final segment is the file the pattern matches, not a
      // directory it scopes.
      break;
    }
    prefix.push(segment);
  }

  return prefix.length > 0 ? posix.join(...prefix) : undefined;
}

/**
 * The single directory every one of `globs` scopes, or `undefined` when the
 * list is empty, any pattern yields no prefix, or the patterns disagree.
 *
 * Several globs derive a directory only when each of them yields the same one:
 * picking the first pattern's prefix, or the common ancestor of all of them,
 * would place the rule somewhere the author never named.
 */
export function getGlobsStaticPrefix(globs: readonly string[]): string | undefined {
  let shared: string | undefined;
  for (const glob of globs) {
    const prefix = getGlobStaticPrefix(glob);
    if (prefix === undefined || (shared !== undefined && prefix !== shared)) {
      return undefined;
    }
    shared = prefix;
  }
  return shared;
}
