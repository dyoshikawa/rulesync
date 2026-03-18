import { z } from "zod/mini";

export const PermissionActionSchema = z.enum(["allow", "ask", "deny"]);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

export const PermissionEntrySchema = z.looseObject({
  tool: z.string().check(z.minLength(1, "tool must be non-empty"), z.regex(/^[a-zA-Z0-9_.-]+$/)),
  pattern: z
    .array(z.string().check(z.regex(/^[^()]*$/)))
    .check(z.minLength(1, "pattern must be non-empty")),
  action: PermissionActionSchema,
});
export type PermissionEntry = z.infer<typeof PermissionEntrySchema>;

export const PermissionPatternSchema = z
  .string()
  .check(
    z.minLength(1, "pattern must be non-empty"),
    z.regex(/^[^()]*$/),
    z.regex(/\S/, "pattern must contain a non-space character"),
  );

export const PermissionsMapSchema = z.record(
  z.string().check(z.minLength(1, "tool must be non-empty"), z.regex(/^[a-zA-Z0-9_.-]+$/)),
  z.record(PermissionPatternSchema, PermissionActionSchema),
);

export const PermissionsExternalConfigSchema = z.looseObject({
  $schema: z.optional(z.string()),
  permissions: PermissionsMapSchema,
});
export type PermissionsExternalConfig = z.infer<typeof PermissionsExternalConfigSchema>;

export type PermissionsMap = z.infer<typeof PermissionsMapSchema>;

export type PermissionsConfig = {
  $schema?: string;
  permissions: PermissionEntry[];
};

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
  return joined.split("/");
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

export function permissionsMapToEntries(permissions: PermissionsMap): PermissionEntry[] {
  const entries: PermissionEntry[] = [];

  for (const [tool, patterns] of Object.entries(permissions)) {
    for (const [pattern, action] of Object.entries(patterns)) {
      entries.push({
        tool,
        pattern: splitPattern(tool, pattern),
        action,
      });
    }
  }

  return entries;
}

export function entriesToPermissionsMap(entries: PermissionEntry[]): PermissionsMap {
  const permissions: PermissionsMap = {};

  for (const entry of entries) {
    const joined = joinPattern(entry.tool, entry.pattern);
    const toolPermissions = permissions[entry.tool] ?? {};
    toolPermissions[joined] = entry.action;
    permissions[entry.tool] = toolPermissions;
  }

  return permissions;
}

export function buildRulesyncPermissionsFileContent({
  entries,
  schema,
}: {
  entries: PermissionEntry[];
  schema?: string;
}): string {
  const config: PermissionsExternalConfig = {
    ...(schema ? { $schema: schema } : {}),
    permissions: entriesToPermissionsMap(entries),
  };

  return JSON.stringify(config, null, 2);
}
