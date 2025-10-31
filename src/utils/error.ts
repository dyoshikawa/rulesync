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
export function formatError(error: unknown): string {
  // Check for ZodError by duck typing (handles both zod and zod/mini)
  if (
    error instanceof ZodError ||
    (error &&
      typeof error === "object" &&
      "issues" in error &&
      Array.isArray(error.issues))
  ) {
    return error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      })
      .join("; ");
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
