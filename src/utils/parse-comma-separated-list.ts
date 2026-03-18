/**
 * Parses a comma-separated string into a trimmed, non-empty array of strings.
 *
 * Handles trailing commas and extra whitespace gracefully.
 *
 * @example
 * parseCommaSeparatedList("a, b, c") // => ["a", "b", "c"]
 * parseCommaSeparatedList("a,,b,")   // => ["a", "b"]
 */
export const parseCommaSeparatedList = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
