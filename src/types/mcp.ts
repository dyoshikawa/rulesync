import { z } from "zod/mini";

export const McpServerSchema = z.looseObject({
  type: z.optional(z.enum(["stdio", "sse", "http"])),
  command: z.optional(z.union([z.string(), z.array(z.string())])),
  args: z.optional(z.array(z.string())),
  url: z.optional(z.string()),
  httpUrl: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  disabled: z.optional(z.boolean()),
  networkTimeout: z.optional(z.number()),
  timeout: z.optional(z.number()),
  trust: z.optional(z.boolean()),
  cwd: z.optional(z.string()),
  transport: z.optional(z.enum(["stdio", "sse", "http"])),
  alwaysAllow: z.optional(z.array(z.string())),
  tools: z.optional(z.array(z.string())),
  kiroAutoApprove: z.optional(z.array(z.string())),
  kiroAutoBlock: z.optional(z.array(z.string())),
  headers: z.optional(z.record(z.string(), z.string())),
  enabledTools: z.optional(z.array(z.string())),
  disabledTools: z.optional(z.array(z.string())),
});

export const McpServersSchema = z.record(z.string(), McpServerSchema);
export type McpServers = z.infer<typeof McpServersSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;

/**
 * Loose guard for `mcpServers` values from parsed JSON: a non-null plain object.
 * Excludes arrays (`typeof [] === "object"`). Tool MCP layers use this before structural transforms;
 * stricter validation may follow elsewhere.
 */
export function isMcpServers(value: unknown): value is McpServers {
  return (
    value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
  );
}
