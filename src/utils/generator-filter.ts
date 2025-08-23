import type { FeatureType } from "../types/config-options.js";
import { normalizeFeatures } from "./feature-validator.js";

/**
 * Maps generator names to their corresponding feature types
 */
const GENERATOR_FEATURE_MAP: Record<string, FeatureType> = {
  // rules
  copilot: "rules",
  cursor: "rules",
  cline: "rules",
  augmentcode: "rules",
  claudecode: "rules",
  roo: "rules",
  geminicli: "rules",
  junie: "rules",
  kiro: "rules",
  windsurf: "rules",
  opencode: "rules",
  amazonqcli: "rules",
  codexcli: "rules",
  qwencode: "rules",

  // commands
  "claudecode-commands": "commands",
  "roo-commands": "commands",
  "geminicli-commands": "commands",
  "amazonqcli-commands": "commands",
  "qwencode-commands": "commands",

  // mcp
  "claudecode-mcp": "mcp",
  "cline-mcp": "mcp",
  "cursor-mcp": "mcp",
  "augmentcode-mcp": "mcp",
  "roo-mcp": "mcp",
  "junie-mcp": "mcp",
  "kiro-mcp": "mcp",
  "windsurf-mcp": "mcp",
  "opencode-mcp": "mcp",
  "geminicli-mcp": "mcp",
  "copilot-mcp": "mcp",
  "amazonqcli-mcp": "mcp",
  "codexcli-mcp": "mcp",
  "qwencode-mcp": "mcp",

  // ignore
  "cursor-ignore": "ignore",
  "cline-ignore": "ignore",
  "augmentcode-ignore": "ignore",
  "roo-ignore": "ignore",
  "junie-ignore": "ignore",
  "kiro-ignore": "ignore",
  "windsurf-ignore": "ignore",
  "opencode-ignore": "ignore",
  "geminicli-ignore": "ignore",
  "copilot-ignore": "ignore",
  "amazonqcli-ignore": "ignore",
  "codexcli-ignore": "ignore",
  "qwencode-ignore": "ignore",
  "claudecode-ignore": "ignore",
};

/**
 * Basic generator information interface
 */
export interface GeneratorInfo {
  name: string;
  [key: string]: unknown;
}

/**
 * Maps a generator name to its feature type
 */
export function mapGeneratorToFeatureType(generatorName: string): FeatureType | null {
  return GENERATOR_FEATURE_MAP[generatorName] || null;
}

/**
 * Filters generators based on the specified features
 */
export function filterGeneratorsByFeatures(
  generators: GeneratorInfo[],
  features: FeatureType[] | "*" | undefined,
): GeneratorInfo[] {
  const normalizedFeatures = normalizeFeatures(features);

  return generators.filter((generator) => {
    const featureType = mapGeneratorToFeatureType(generator.name);

    // If generator is not mapped to any feature type, include it for backward compatibility
    if (featureType === null) {
      return true;
    }

    return normalizedFeatures.includes(featureType);
  });
}

/**
 * Groups generators by their feature types
 */
export function groupGeneratorsByFeature(
  generators: GeneratorInfo[],
): Record<FeatureType | "unmapped", GeneratorInfo[]> {
  const groups: Record<FeatureType | "unmapped", GeneratorInfo[]> = {
    rules: [],
    commands: [],
    mcp: [],
    ignore: [],
    subagents: [],
    unmapped: [],
  };

  for (const generator of generators) {
    const featureType = mapGeneratorToFeatureType(generator.name);
    if (featureType) {
      groups[featureType].push(generator);
    } else {
      groups.unmapped.push(generator);
    }
  }

  return groups;
}

/**
 * Gets all generator names for a specific feature type
 */
export function getGeneratorsForFeature(featureType: FeatureType): string[] {
  return Object.entries(GENERATOR_FEATURE_MAP)
    .filter(([, type]) => type === featureType)
    .map(([name]) => name);
}

/**
 * Validates that all requested features have at least one generator
 */
export function validateFeaturesHaveGenerators(
  features: FeatureType[],
  availableGenerators: GeneratorInfo[],
): { valid: boolean; missingFeatures: FeatureType[] } {
  const availableFeatures = new Set(
    availableGenerators
      .map((g) => mapGeneratorToFeatureType(g.name))
      .filter((f): f is FeatureType => f !== null),
  );

  const missingFeatures = features.filter((feature) => !availableFeatures.has(feature));

  return {
    valid: missingFeatures.length === 0,
    missingFeatures,
  };
}
