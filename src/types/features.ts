import { z } from "zod/mini";

export const ALL_FEATURES = [
  "rules",
  "ignore",
  "mcp",
  "subagents",
  "commands",
  "skills",
  "hooks",
  "permissions",
] as const;

export const ALL_FEATURES_WITH_WILDCARD = [...ALL_FEATURES, "*"] as const;

export const FeatureSchema = z.enum(ALL_FEATURES);

export type Feature = z.infer<typeof FeatureSchema>;

export const FeaturesSchema = z.array(FeatureSchema);

export type Features = z.infer<typeof FeaturesSchema>;

// Type for individual feature array with wildcard support
export type FeatureWithWildcard = Feature | "*";

// Free-form options object that may be passed for a specific feature.
// Each tool/feature is responsible for parsing and validating its own keys.
export type FeatureOptions = Record<string, unknown>;

// Value of a single feature in the per-feature object form:
// - true: enable with default options
// - false: disable
// - object: enable with the given options
export type FeatureValue = boolean | FeatureOptions;

// Schema for features - supports both array and per-target object formats
// Array format: ["rules", "ignore", ...] or ["*"]
// Object format (array per target): { "copilot": ["commands"], "agentsmd": ["rules", "mcp"] }
// Object format (per-feature options per target):
//   { "claudecode": { "ignore": { "fileMode": "local" }, "rules": true } }
const FeatureOptionsSchema = z.record(z.string(), z.unknown());
const FeatureValueSchema = z.union([z.boolean(), FeatureOptionsSchema]);
const PerFeatureConfigSchema = z.record(z.enum(ALL_FEATURES_WITH_WILDCARD), FeatureValueSchema);
export const RulesyncFeaturesSchema = z.union([
  z.array(z.enum(ALL_FEATURES_WITH_WILDCARD)),
  z.record(
    z.string(),
    z.union([z.array(z.enum(ALL_FEATURES_WITH_WILDCARD)), PerFeatureConfigSchema]),
  ),
]);

// zod's `z.record(K, V)` infers `Record<K, V>` (non-partial), but at runtime
// missing keys are perfectly valid. We surface that to TS by wrapping the
// inferred types in `Partial<...>` so callers can provide just the subset of
// targets / features they care about.

// Per-feature configuration map for a single target.
// Example: { ignore: { fileMode: "local" }, rules: true }
export type PerFeatureConfig = Partial<z.infer<typeof PerFeatureConfigSchema>>;

// Per-target features value: either the existing array form or the new
// per-feature object form.
export type PerTargetFeaturesValue = Array<FeatureWithWildcard> | PerFeatureConfig;

// Per-target features configuration - maps target to its features.
export type PerTargetFeatures = Partial<Record<string, PerTargetFeaturesValue>>;

export type RulesyncFeatures = Array<FeatureWithWildcard> | PerTargetFeatures;

/**
 * Type guard: returns true when a per-target features value uses the
 * per-feature object form rather than the array form.
 */
export const isPerFeatureConfig = (value: PerTargetFeaturesValue): value is PerFeatureConfig => {
  return !Array.isArray(value);
};
