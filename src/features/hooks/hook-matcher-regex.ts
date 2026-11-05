import { stripControlChars } from "../../types/hooks.js";

/**
 * Prepare a hook matcher for embedding in generated code as a regular
 * expression: strip control characters, widen the bare `*` wildcard to `.*`,
 * and reject a pattern that does not compile. The caller still quotes the
 * result for the string literal it embeds it in.
 */
export function sanitizeMatcherRegex(matcher: string): string {
  let sanitized = stripControlChars(matcher);
  if (sanitized === "*") {
    sanitized = ".*";
  }
  try {
    new RegExp(sanitized);
  } catch {
    throw new Error(`Invalid regex pattern in hook matcher: ${sanitized}`);
  }
  return sanitized;
}
