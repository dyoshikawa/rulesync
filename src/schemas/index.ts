import { z } from "zod/v4";

// Tool target schema
export const ToolTargetSchema = z.enum([
  "copilot",
  "cursor",
  "cline",
  "claudecode",
  "roo",
  "geminicli",
]);

// Rule frontmatter schema for validation only
export const RuleFrontmatterSchema = z.object({
  root: z.boolean(),
  targets: z.union([z.tuple([z.literal("*")]), z.array(ToolTargetSchema)]),
  description: z.string(),
  globs: z.array(z.string()),
  cursorRuleType: z.enum(["always", "manual", "specificFiles", "intelligently"]).optional(),
});

// Generic JSON object schema
export const JsonObjectSchema = z.record(z.string(), z.unknown());

// MCP server transport schema
export const TransportSchema = z.enum(["stdio", "sse", "http"]);

// MCP server schema for validation only
export const RulesyncMcpServerSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  httpUrl: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  disabled: z.boolean().optional(),
  networkTimeout: z.number().optional(),
  timeout: z.number().optional(),
  trust: z.boolean().optional(),
  cwd: z.string().optional(),
  transport: TransportSchema.optional(),
  type: z.enum(["sse", "streamable-http"]).optional(),
  alwaysAllow: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  targets: z.union([z.tuple([z.literal("*")]), z.array(ToolTargetSchema)]).optional(),
});

// MCP config schema for validation only
export const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServerSchema),
});

// Claude settings permissions schema
export const ClaudePermissionsSchema = z.object({
  deny: z.array(z.string()).optional(),
});

// Claude settings schema
export const ClaudeSettingsSchema = z.object({
  permissions: ClaudePermissionsSchema.optional(),
  mcpServers: z.record(z.string(), RulesyncMcpServerSchema).optional(),
});
