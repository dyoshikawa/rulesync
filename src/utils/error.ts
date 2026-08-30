import { ZodError } from "zod";

import {
  stripControlCharacters,
  stripControlCharactersKeepingLineFeeds,
} from "./control-characters.js";
import { truncateText } from "./truncate.js";

/**
 * Convert various error types to a readable error message
 * @param error Error instance (ZodError, Error, or unknown)
 * @returns Human-readable error message
 *
 * @example
 * // ZodError
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   throw new Error(`Validation failed: ${formatError(result.error)}`);
 * }
 *
 * @example
 * // Standard Error
 * try {
 *   // some operation
 * } catch (error) {
 *   console.error(formatError(error));
 * }
 */
// Type guard for ZodError-like objects
function isZodErrorLike(error: unknown): error is {
  issues: Array<{ path: Array<string | number>; message: string }>;
} {
  return (
    error !== null &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues) &&
    error.issues.every(
      (issue: unknown) =>
        issue !== null &&
        typeof issue === "object" &&
        "path" in issue &&
        Array.isArray(issue.path) &&
        "message" in issue &&
        typeof issue.message === "string",
    )
  );
}

/**
 * How much of a Zod error the formatted message spells out.
 *
 * One `safeParse` of a large invalid document produces an issue per offending
 * node, each carrying the path and message, so the raw expansion is bounded by
 * the size of the input rather than by anything rulesync decides — and the
 * formatted message no longer stops at a terminal: it becomes the `message` of
 * a `--json` failure document and of an MCP result. The first few issues are
 * what tells the reader which file to open; the rest is the same information
 * again, at whatever length the input chose.
 */
const MAX_ZOD_ISSUES_LENGTH = 2_000;

/**
 * How much of any other error the formatted message spells out.
 *
 * Larger than the Zod bound because the text is the error's own sentence rather
 * than a re-listing of one issue per offending node, and because the MCP
 * `generate` failure hands this one a line per unreadable source. Bounded all
 * the same: a parser quotes the offending line verbatim, and a minified file is
 * one line the length of the file.
 */
const MAX_ERROR_MESSAGE_LENGTH = 8_000;

/**
 * Strip and bound an error message that is about to be read by something other
 * than a terminal — a `--json` failure document, an MCP result.
 *
 * The line feed stays: several messages are deliberately written over more than
 * one line, and running them together would cost more than the newline can do
 * here. Everything that reorders the text around it, or that an escape sequence
 * is written with, goes.
 */
function boundErrorMessage(text: string): string {
  return truncateText({
    text: stripControlCharactersKeepingLineFeeds(text),
    maxLength: MAX_ERROR_MESSAGE_LENGTH,
    suffix: "…(truncated)",
  });
}

export function formatError(error: unknown): string {
  // Check for ZodError by duck typing (handles both zod and zod/mini)
  if (error instanceof ZodError || isZodErrorLike(error)) {
    // Stripped as well as bounded: the issues are already JSON-encoded, so no
    // newline of the message's own is lost, but `JSON.stringify` escapes C0
    // only — a path or a custom message read out of an untrusted document can
    // still carry a C1 introducer or a bidirectional override.
    const issues = stripControlCharacters(JSON.stringify(error.issues));
    return `Zod raw error: ${truncateText({
      text: issues,
      maxLength: MAX_ZOD_ISSUES_LENGTH,
      suffix: "…(truncated)",
    })}`;
  }

  if (error instanceof Error) {
    return boundErrorMessage(`${error.name}: ${error.message}`);
  }

  return boundErrorMessage(String(error));
}
