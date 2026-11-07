import { warnWithFallback, type Logger } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";

/**
 * Translate the path of a Claude Code style `Read(<path>)` deny into the
 * gitignore syntax of `.rulesync/.aiignore`.
 *
 * Claude Code reads the path forms differently from gitignore: `./path` is
 * relative to the current directory, `/path` to the project root, `//path` is
 * absolute and `~/path` is under the home directory. Copied verbatim, the
 * common `Read(./.env)` idiom would become `./.env`, which matches nothing in
 * a gitignore-syntax ignore file, so every other tool would lose the deny.
 *
 * - `./path` is anchored to the project root as `/path`.
 * - `//path` and `~/path` (or a bare `~`) name locations a project-relative
 *   ignore file cannot express; they are skipped with a warning and `null` is
 *   returned.
 * - Every other path (`.env`, `secrets/**`, `/path`) already means the same
 *   project files in gitignore syntax and is kept as is.
 */
export function claudeReadDenyPathToIgnorePattern({
  path,
  toolLabel,
  logger,
}: {
  path: string;
  toolLabel: string;
  logger?: Logger;
}): string | null {
  if (path.startsWith("//") || path === "~" || path.startsWith("~/")) {
    warnWithFallback(
      logger,
      `Skipping ${toolLabel} read deny ${quoteValueForWarning(path)} on ignore import: ` +
        `an absolute or home-directory path cannot be expressed in the project-relative ` +
        `.rulesync/.aiignore.`,
    );
    return null;
  }
  if (path.startsWith("./")) {
    const rest = path.slice(2).replace(/^(?:\.\/)+/, "");
    return rest.length > 0 ? `/${rest}` : null;
  }
  return path;
}
