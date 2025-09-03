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
  "warp",
  "windsurf",
] as const;

export const ALL_TOOL_TARGETS_WITH_WILDCARD = [...ALL_TOOL_TARGETS, "*"] as const;

export const ToolTargetSchema = z.enum(ALL_TOOL_TARGETS);

export type ToolTarget = z.infer<typeof ToolTargetSchema>;

export const ToolTargetsSchema = z.array(ToolTargetSchema);

export type ToolTargets = z.infer<typeof ToolTargetsSchema>;

export const RulesyncTargetsSchema = z.array(z.enum(ALL_TOOL_TARGETS_WITH_WILDCARD));

export type RulesyncTargets = z.infer<typeof RulesyncTargetsSchema>;
