import { z } from "zod/mini";

export const ALL_FEATURES = ["rules", "ignore", "mcp", "subagents", "commands", "skills"] as const;

export const ALL_FEATURES_WITH_WILDCARD = [...ALL_FEATURES, "*"] as const;

export const FeatureSchema = z.enum(ALL_FEATURES);

export type Feature = z.infer<typeof FeatureSchema>;

export const FeaturesSchema = z.array(FeatureSchema);

export type Features = z.infer<typeof FeaturesSchema>;

export const RulesyncFeaturesSchema = z.array(z.enum(ALL_FEATURES_WITH_WILDCARD));

export type RulesyncFeatures = z.infer<typeof RulesyncFeaturesSchema>;
