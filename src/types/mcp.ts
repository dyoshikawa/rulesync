import { refine, z } from "zod/mini";

const EnvVarNameSchema = z
  .string()
  .check(
    refine(
      (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value),
      "envVars entries must be valid environment variable names",
    ),
  );

export const McpServerSchema = z.looseObject({
  // `streamable-http` is the MCP spec's transport name and an accepted alias for
  // `http` (Claude Code), so configs copied from server docs work unchanged.
  // `ws` is Claude Code's WebSocket transport (same url/headers/timeout fields as http).
  type: z.optional(z.enum(["local", "stdio", "sse", "http", "ws", "streamable-http"])),
  command: z.optional(z.union([z.string(), z.array(z.string())])),
  args: z.optional(z.array(z.string())),
  url: z.optional(z.string()),
  httpUrl: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  // Codex CLI-specific: list of shell env var names that codex should pass
  // through from the user's environment to the MCP server process.
  // Distinct from `env` (a literal name→value map): `envVars` is a list of
  // variable NAMES whose values come from the user's shell at runtime.
  // Only honoured by the codex generator (renamed to `env_vars` in codex
  // TOML output, matching codex's native field name — see the
  // `enabledTools`→`enabled_tools` precedent in `codexcli-mcp.ts`).
  // Stripped by `RulesyncMcp.getMcpServers()` so it does not leak into
  // other tools' configs.
  envVars: z.optional(z.array(EnvVarNameSchema)),
  disabled: z.optional(z.boolean()),
  networkTimeout: z.optional(z.number()),
  timeout: z.optional(z.number()),
  trust: z.optional(z.boolean()),
  cwd: z.optional(z.string()),
  transport: z.optional(z.enum(["local", "stdio", "sse", "http", "ws", "streamable-http"])),
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
