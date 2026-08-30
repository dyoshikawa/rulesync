import { ZodError } from "zod";

import { stripControlCharacters } from "./control-characters.js";
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
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
