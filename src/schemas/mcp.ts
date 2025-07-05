import { z } from "zod/v4";

export const ToolTargetSchema = z.enum([
  "copilot",
  "cursor",
  "cline",
  "claudecode",
  "roo",
  "geminicli",
]);

export const WildcardTargetSchema = z.tuple([z.literal("*")]);
export const SpecificTargetsSchema = z.array(ToolTargetSchema);

export const RulesyncTargetsSchema = z.union([SpecificTargetsSchema, WildcardTargetSchema]);

export const McpTransportTypeSchema = z.enum(["stdio", "sse", "http"]);

export const McpServerBaseSchema = z.object({
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
  transport: McpTransportTypeSchema.optional(),
  type: z.enum(["sse", "streamable-http"]).optional(),
  alwaysAllow: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
});

export const RulesyncMcpServerSchema = McpServerBaseSchema.extend({
  targets: RulesyncTargetsSchema.optional(),
});

export type ParsedRulesyncTargets = z.infer<typeof RulesyncTargetsSchema>;
export type ParsedRulesyncMcpServer = z.infer<typeof RulesyncMcpServerSchema>;
