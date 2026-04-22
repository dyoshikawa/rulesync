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
