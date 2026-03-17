import { z } from "zod/mini";

export const PermissionActionSchema = z.enum(["allow", "ask", "deny"]);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

export const PermissionEntrySchema = z.looseObject({
  tool: z.string().check(z.regex(/^[a-zA-Z0-9_]+$/)),
  pattern: z.array(z.string().check(z.regex(/^[^()]*$/))),
  action: PermissionActionSchema,
});
export type PermissionEntry = z.infer<typeof PermissionEntrySchema>;

export const PermissionsConfigSchema = z.looseObject({
  $schema: z.optional(z.string()),
  permissions: z.array(PermissionEntrySchema),
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

// Canonical tool name → Claude Code PascalCase name
export const CANONICAL_TO_CLAUDE_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  grep: "Grep",
  glob: "Glob",
};

// Claude Code PascalCase name → canonical tool name
export const CLAUDE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CLAUDE_TOOL_NAMES).map(([k, v]) => [v, k]),
);

// OpenCode uses lowercase tool names identical to canonical names.
// No mapping is needed; the canonical name is used directly.

/**
 * Join pattern segments for bash tool (space-separated)
 */
export function joinPatternForBash(pattern: string[]): string {
  return pattern.join(" ");
}

/**
 * Join pattern segments for file path tools (/-separated)
 */
export function joinPatternForPath(pattern: string[]): string {
  return pattern.join("/");
}

/**
 * Split a joined pattern back to segments for bash tool (space-separated)
 */
export function splitPatternForBash(joined: string): string[] {
  return joined.split(" ").filter((s) => s !== "");
}

/**
 * Split a joined pattern back to segments for file path tools (/-separated)
 */
export function splitPatternForPath(joined: string): string[] {
  return joined.split("/").filter((s) => s !== "");
}

/**
 * Join pattern segments based on tool type
 */
export function joinPattern(tool: string, pattern: string[]): string {
  if (tool === "bash") {
    return joinPatternForBash(pattern);
  }
  return joinPatternForPath(pattern);
}

/**
 * Split a joined pattern back to segments based on tool type
 */
export function splitPattern(tool: string, joined: string): string[] {
  if (tool === "bash") {
    return splitPatternForBash(joined);
  }
  return splitPatternForPath(joined);
}
