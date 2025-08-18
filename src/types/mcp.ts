import { z } from "zod/mini";
import { RulesyncTargetsSchema } from "./tool-targets.js";

export const McpTransportTypeSchema = z.enum(["stdio", "sse", "http"]);

export const McpServerBaseSchema = z.object({
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
  transport: z.optional(McpTransportTypeSchema),
  type: z.optional(z.enum(["sse", "streamable-http"])),
  alwaysAllow: z.optional(z.array(z.string())),
  tools: z.optional(z.array(z.string())),
  kiroAutoApprove: z.optional(z.array(z.string())),
  kiroAutoBlock: z.optional(z.array(z.string())),
  headers: z.optional(z.record(z.string(), z.string())),
});

export const RulesyncMcpServerSchema = z.extend(McpServerBaseSchema, {
  targets: z.optional(RulesyncTargetsSchema),
});

export const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerBaseSchema),
});

export const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServerSchema),
});

export type McpTransportType = z.infer<typeof McpTransportTypeSchema>;
export type McpServerBase = z.infer<typeof McpServerBaseSchema>;
export type RulesyncMcpServer = z.infer<typeof RulesyncMcpServerSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type RulesyncMcpConfig = z.infer<typeof RulesyncMcpConfigSchema>;
