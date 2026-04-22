import { z } from "zod/mini";

/**
 * Shared utilities for all TAKT-* tool file classes.
 *
 * TAKT emits flat plain-Markdown facet files under `.takt/facets/<category>/<stem>.md`.
 * The filename stem may be overridden via `takt.name` in the source frontmatter.
 * Because the stem becomes a real filename component, it must be validated to
 * prevent path traversal or accidental directory escapes.
 */

/**
 * Allowed characters in a TAKT filename stem.
 *
 * Conservative on purpose: ASCII letters/digits, underscore, hyphen, and dot.
 * Forbids `/`, `\`, leading/embedded `..`, and any other separator-like char.
 */
const TAKT_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/u;

/**
 * Validate that a TAKT filename stem (`takt.name` or the source stem) is
 * safe to use as a filename component. Throws a clear error otherwise.
 *
 * @param name        The proposed filename stem (without `.md`).
 * @param featureLabel The rulesync feature name (e.g. `"rule"`, `"skill"`).
 * @param sourceLabel  A reference to the source file (used in the error message).
 */
export function assertSafeTaktName({
  name,
  featureLabel,
  sourceLabel,
}: {
  name: string;
  featureLabel: string;
  sourceLabel: string;
}): void {
  if (
    !TAKT_NAME_PATTERN.test(name) ||
    name === "." ||
    name === ".." ||
    name.split(/[.]/u).some((segment) => segment === "..")
  ) {
    throw new Error(
      `Invalid takt.name "${name}" for ${featureLabel} "${sourceLabel}": ` +
        `filename stems may not contain path separators or ".." segments.`,
    );
  }
}

/**
 * Resolve a TAKT facet directory from an optional `takt.facet` value.
 *
 * Generic helper used by all four TAKT-* tool file classes (rule, subagent,
 * command, skill). Each feature defines its own allowed values and default;
 * this helper validates the supplied value and returns the corresponding
 * directory name.
 *
 * @throws when `value` is non-string or not in `allowed`.
 */
export function resolveTaktFacetDir<TAllowed extends string>({
  value,
  allowed,
  defaultDir,
  dirMap,
  featureLabel,
  sourceLabel,
}: {
  value: unknown;
  allowed: ReadonlyArray<TAllowed>;
  defaultDir: string;
  dirMap: Readonly<Record<TAllowed, string>>;
  featureLabel: string;
  sourceLabel: string;
}): string {
  if (value === undefined || value === null) {
    return defaultDir;
  }
  if (typeof value !== "string") {
    throw new Error(
      `Invalid takt.facet for ${featureLabel} "${sourceLabel}": expected a string, got ${typeof value}.`,
    );
  }
  const parsed = z.enum(allowed).safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid takt.facet "${value}" for ${featureLabel} "${sourceLabel}". ` +
        `Allowed values for ${featureLabel}s: ${allowed.join(", ")}.`,
    );
  }
  return dirMap[parsed.data];
}
