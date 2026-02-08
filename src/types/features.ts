import { z } from "zod/mini";

import type { ToolTarget } from "./tool-targets.js";

export const ALL_FEATURES = [
  "rules",
  "ignore",
  "mcp",
  "subagents",
  "commands",
  "skills",
  "hooks",
] as const;

export const ALL_FEATURES_WITH_WILDCARD = [...ALL_FEATURES, "*"] as const;

export const FeatureSchema = z.enum(ALL_FEATURES);

export type Feature = z.infer<typeof FeatureSchema>;

export const FeaturesSchema = z.array(FeatureSchema);

export type Features = z.infer<typeof FeaturesSchema>;

// Per-target features configuration - maps target to its features
export type PerTargetFeatures = Partial<Record<ToolTarget, Array<Feature | "*">>>;

// Type for individual feature array with wildcard support
export type FeatureWithWildcard = Feature | "*";

// Schema for features - supports both array and per-target object formats
// Array format: ["rules", "ignore", ...] or ["*"]
// Object format: { "copilot": ["commands"], "agentsmd": ["rules", "mcp"] }
export const RulesyncFeaturesSchema = z.union([
  z.array(z.enum(ALL_FEATURES_WITH_WILDCARD)),
  z.record(z.string(), z.array(z.enum(ALL_FEATURES_WITH_WILDCARD))),
]);

export type RulesyncFeatures = Array<FeatureWithWildcard> | PerTargetFeatures;
