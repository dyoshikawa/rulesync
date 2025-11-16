// eslint-disable-next-line zod-import/zod-import
import { ZodError } from "zod";

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

export function formatError(error: unknown): string {
  // Check for ZodError by duck typing (handles both zod and zod/mini)
  if (error instanceof ZodError || isZodErrorLike(error)) {
    return `Zod raw error: ${JSON.stringify(error.issues)}`;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
