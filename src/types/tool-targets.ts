import { z } from "zod/mini";

export const ALL_TOOL_TARGETS = [
  "agentsmd",
  "amazonqcli",
  "augmentcode",
  "augmentcode-legacy",
  "copilot",
  "cursor",
  "cline",
  "claudecode",
  "codexcli",
  "opencode",
  "qwencode",
  "roo",
  "geminicli",
  "kiro",
  "junie",
  "windsurf",
] as const;

export const ToolTargetSchema = z.enum(ALL_TOOL_TARGETS);

export type ToolTarget = z.infer<typeof ToolTargetSchema>;

export const ToolTargetsSchema = z.array(ToolTargetSchema);

export type ToolTargets = z.infer<typeof ToolTargetsSchema>;

export const WildcardTargetSchema = z.tuple([z.literal("*")]);

export const RulesyncTargetsSchema = z.union([ToolTargetsSchema, WildcardTargetSchema]);

export type RulesyncTargets = z.infer<typeof RulesyncTargetsSchema>;

export function isToolTarget(target: string | undefined): target is ToolTarget {
  if (!target) return false;

  return ALL_TOOL_TARGETS.some((validTarget) => validTarget === target);
}
