/**
 * Convert ZodError to a readable error message
 * @param error ZodError instance from safeParse
 * @returns Human-readable error message
 *
 * @example
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   throw new Error(`Validation failed: ${formatZodError(result.error)}`);
 * }
 */
export function formatZodError(error: {
  issues: Array<{ path: (string | number)[]; message: string }>;
}): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}
