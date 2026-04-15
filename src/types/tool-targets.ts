import { z } from "zod/mini";

import { PerTargetFeaturesValueSchema } from "./features.js";
import type { PerFeatureConfig, PerTargetFeaturesValue } from "./features.js";

export const ALL_TOOL_TARGETS = [
  "agentsmd",
  "agentsskills",
  "antigravity",
  "augmentcode",
  "augmentcode-legacy",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "copilotcli",
  "cursor",
  "deepagents",
  "factorydroid",
  "geminicli",
  "goose",
  "junie",
  "kilo",
  "kiro",
  "opencode",
  "qwencode",
  "replit",
  "roo",
  "rovodev",
  "warp",
  "windsurf",
  "zed",
] as const;

export const ALL_TOOL_TARGETS_WITH_WILDCARD = [...ALL_TOOL_TARGETS, "*"] as const;

export const ToolTargetSchema = z.enum(ALL_TOOL_TARGETS);

export type ToolTarget = z.infer<typeof ToolTargetSchema>;

export const ToolTargetsSchema = z.array(ToolTargetSchema);

export type ToolTargets = z.infer<typeof ToolTargetsSchema>;

// `RulesyncTargetsSchema` is the legacy array-form schema. Used widely by
// frontmatter parsers for rules / commands / mcp / subagents / skills,
// which only accept the array form.
export const RulesyncTargetsSchema = z.array(z.enum(ALL_TOOL_TARGETS_WITH_WILDCARD));

export type RulesyncTargets = z.infer<typeof RulesyncTargetsSchema>;

// `RulesyncConfigTargetsSchema` is the union (array | object) used for
// `root.targets` inside `rulesync.jsonc`. The object form mirrors the
// per-target object form of `features`: the keys declare which tools to
// target, and the values carry the per-tool feature configuration.
// NOTE: We use `z.string()` for the key schema (not `z.enum(...)`) for the
// same reason as `RulesyncFeaturesSchema`: `z.record(z.enum(...))` requires
// ALL enum members to be present. Unknown target names (and the `*` key) are
// rejected at runtime by `Config#validateObjectFormTargetKeys`, which throws
// with a descriptive message listing the valid targets.
export const RulesyncConfigTargetsObjectSchema = z.record(z.string(), PerTargetFeaturesValueSchema);
export const RulesyncConfigTargetsSchema = z.union([
  RulesyncTargetsSchema,
  RulesyncConfigTargetsObjectSchema,
]);

// The Zod schema infers `Record<string, ...>` (non-partial); we override
// with `Partial<Record<ToolTarget, ...>>` so callers can supply just the
// subset of targets they care about, and so typos are caught at compile
// time.
export type RulesyncConfigTargetsObject = Partial<Record<ToolTarget, PerTargetFeaturesValue>>;

export type RulesyncConfigTargets = RulesyncTargets | RulesyncConfigTargetsObject;

/**
 * Type guard: returns true when `root.targets` is in the per-target object form.
 */
export const isRulesyncConfigTargetsObject = (
  value: RulesyncConfigTargets,
): value is RulesyncConfigTargetsObject => {
  return !Array.isArray(value);
};

// Re-export for callers that consume per-target values from the targets
// object form without also pulling from features.ts directly.
export type { PerFeatureConfig, PerTargetFeaturesValue };
