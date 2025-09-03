import { z } from "zod/mini";

export const ALL_FEATURES = ["rules", "ignore", "mcp", "subagents", "commands"] as const;

export const ALL_FEATURES_WITH_WILDCARD = [...ALL_FEATURES, "*"] as const;

// Create mutable versions for zod.enum which doesn't work well with readonly arrays
const FEATURES_ENUM = ["rules", "ignore", "mcp", "subagents", "commands"] as const;
const FEATURES_WITH_WILDCARD_ENUM = [
  "rules",
  "ignore",
  "mcp",
  "subagents",
  "commands",
  "*",
] as const;

export const FeatureSchema = z.enum(FEATURES_ENUM);

export type Feature = z.infer<typeof FeatureSchema>;

export const FeaturesSchema = z.array(FeatureSchema);

export type Features = z.infer<typeof FeaturesSchema>;

export const RulesyncFeaturesSchema = z.array(z.enum(FEATURES_WITH_WILDCARD_ENUM));

export type RulesyncFeatures = z.infer<typeof RulesyncFeaturesSchema>;
