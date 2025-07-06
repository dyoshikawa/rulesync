import { z } from "zod/v4-mini";

export const ToolTargetSchema = z.enum([
  "copilot",
  "cursor",
  "cline",
  "claudecode",
  "roo",
  "geminicli",
]);

export type ToolTarget = z.infer<typeof ToolTargetSchema>;

export const ToolTargetsSchema = z.array(ToolTargetSchema);

export type ToolTargets = z.infer<typeof ToolTargetsSchema>;

export const WildcardTargetSchema = z.tuple([z.literal("*")]);

export const RulesyncTargetsSchema = z.union([ToolTargetsSchema, WildcardTargetSchema]);
