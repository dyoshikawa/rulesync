/**
 * Parse a `Tool(pattern)` permission entry (e.g. `Bash(npm run *)`) into its
 * tool name and pattern. The tool name is everything before the first `(` and
 * the pattern is everything up to the final `)`, so patterns that themselves
 * contain parentheses (e.g. `Bash(echo (a))`) round-trip. A bare entry is the
 * whole tool with pattern `*`; an entry that opens `(` but does not end with
 * `)` is treated as malformed and falls back to the bare tool name with `*`,
 * as does an empty `Tool()`.
 */
export function parseToolPatternEntry(entry: string): { toolName: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  if (!entry.endsWith(")")) {
    return { toolName, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { toolName, pattern: pattern || "*" };
}

/**
 * Build a `Tool(pattern)` permission entry. The `*` pattern collapses to the
 * bare tool name, which matches the whole tool.
 */
export function buildToolPatternEntry({
  toolName,
  pattern,
}: {
  toolName: string;
  pattern: string;
}): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}
