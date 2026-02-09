import { optional, z } from "zod/mini";

import {
  ALL_FEATURES,
  Feature,
  Features,
  PerTargetFeatures,
  RulesyncFeatures,
  RulesyncFeaturesSchema,
} from "../types/features.js";
import {
  ALL_TOOL_TARGETS,
  RulesyncTargets,
  RulesyncTargetsSchema,
  ToolTarget,
  ToolTargets,
} from "../types/tool-targets.js";

export const ConfigParamsSchema = z.object({
  baseDirs: z.array(z.string()),
  targets: RulesyncTargetsSchema,
  features: RulesyncFeaturesSchema,
  verbose: z.boolean(),
  delete: z.boolean(),
  // New non-experimental options
  global: optional(z.boolean()),
  silent: optional(z.boolean()),
  simulateCommands: optional(z.boolean()),
  simulateSubagents: optional(z.boolean()),
  simulateSkills: optional(z.boolean()),
  modularMcp: optional(z.boolean()),
  dryRun: optional(z.boolean()),
  check: optional(z.boolean()),
});
export type ConfigParams = z.infer<typeof ConfigParamsSchema>;

export const PartialConfigParamsSchema = z.partial(ConfigParamsSchema);
export type PartialConfigParams = z.infer<typeof PartialConfigParamsSchema>;

// Schema for config file that includes $schema property for editor support
export const ConfigFileSchema = z.object({
  $schema: optional(z.string()),
  ...z.partial(ConfigParamsSchema).shape,
});
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

export const RequiredConfigParamsSchema = z.required(ConfigParamsSchema);
export type RequiredConfigParams = z.infer<typeof RequiredConfigParamsSchema>;

/**
 * Conflicting target pairs that cannot be used together
 */
const CONFLICTING_TARGET_PAIRS: Array<[string, string]> = [
  ["augmentcode", "augmentcode-legacy"],
  ["claudecode", "claudecode-legacy"],
];

/**
 * Legacy targets that should NOT be included in wildcard (*) expansion.
 * These targets must be explicitly specified.
 */
const LEGACY_TARGETS = ["augmentcode-legacy", "claudecode-legacy"] as const;

export class Config {
  private readonly baseDirs: string[];
  private readonly targets: RulesyncTargets;
  private readonly features: RulesyncFeatures;
  private readonly verbose: boolean;
  private readonly delete: boolean;
  private readonly global: boolean;
  private readonly silent: boolean;
  private readonly simulateCommands: boolean;
  private readonly simulateSubagents: boolean;
  private readonly simulateSkills: boolean;
  private readonly modularMcp: boolean;
  private readonly dryRun: boolean;
  private readonly check: boolean;

  constructor({
    baseDirs,
    targets,
    features,
    verbose,
    delete: isDelete,
    global,
    silent,
    simulateCommands,
    simulateSubagents,
    simulateSkills,
    modularMcp,
    dryRun,
    check,
  }: ConfigParams) {
    // Validate conflicting targets
    this.validateConflictingTargets(targets);

    // Validate --dry-run and --check are mutually exclusive
    if (dryRun && check) {
      throw new Error("--dry-run and --check cannot be used together");
    }

    this.baseDirs = baseDirs;
    this.targets = targets;
    this.features = features;
    this.verbose = verbose;
    this.delete = isDelete;

    this.global = global ?? false;
    this.silent = silent ?? false;
    this.simulateCommands = simulateCommands ?? false;
    this.simulateSubagents = simulateSubagents ?? false;
    this.simulateSkills = simulateSkills ?? false;
    this.modularMcp = modularMcp ?? false;
    this.dryRun = dryRun ?? false;
    this.check = check ?? false;
  }

  private validateConflictingTargets(targets: RulesyncTargets): void {
    // Check for explicitly specified conflicting targets
    // Note: Wildcard (*) doesn't include legacy targets, so conflicts can only occur
    // when both targets are explicitly specified
    for (const [target1, target2] of CONFLICTING_TARGET_PAIRS) {
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      const hasTarget1 = targets.includes(target1 as RulesyncTargets[number]);
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      const hasTarget2 = targets.includes(target2 as RulesyncTargets[number]);
      if (hasTarget1 && hasTarget2) {
        throw new Error(
          `Conflicting targets: '${target1}' and '${target2}' cannot be used together. Please choose one.`,
        );
      }
    }
  }

  public getBaseDirs(): string[] {
    return this.baseDirs;
  }

  public getTargets(): ToolTargets {
    if (this.targets.includes("*")) {
      // Exclude legacy targets from wildcard expansion
      // Legacy targets must be explicitly specified
      return ALL_TOOL_TARGETS.filter(
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        (target) => !LEGACY_TARGETS.includes(target as (typeof LEGACY_TARGETS)[number]),
      );
    }

    return this.targets.filter((target) => target !== "*");
  }

  public getFeatures(): Features;
  public getFeatures(target: ToolTarget): Features;
  public getFeatures(target?: ToolTarget): Features {
    // Check if features is in object format (per-target configuration)
    if (!Array.isArray(this.features)) {
      // Safe: we've verified it's not an array, so it must be PerTargetFeatures
      const perTargetFeatures: PerTargetFeatures = this.features;
      if (target) {
        // Return features for specific target, defaulting to empty array if not specified
        const targetFeatures = perTargetFeatures[target];
        if (!targetFeatures || targetFeatures.length === 0) {
          // If no features specified for this target, return empty array
          return [];
        }
        if (targetFeatures.includes("*")) {
          return [...ALL_FEATURES];
        }
        return targetFeatures.filter((feature): feature is Feature => feature !== "*");
      }
      // When no target specified but features is an object, collect all unique features
      const allFeatures: Feature[] = [];
      for (const features of Object.values(perTargetFeatures)) {
        if (features && features.length > 0) {
          if (features.includes("*")) {
            return [...ALL_FEATURES];
          }
          for (const feature of features) {
            if (feature !== "*" && !allFeatures.includes(feature)) {
              allFeatures.push(feature);
            }
          }
        }
      }
      return allFeatures;
    }

    // Array format - traditional behavior
    if (this.features.includes("*")) {
      return [...ALL_FEATURES];
    }

    return this.features.filter((feature): feature is Feature => feature !== "*");
  }

  /**
   * Check if per-target features configuration is being used.
   */
  public hasPerTargetFeatures(): boolean {
    return !Array.isArray(this.features);
  }

  public getVerbose(): boolean {
    return this.verbose;
  }

  public getDelete(): boolean {
    return this.delete;
  }

  public getGlobal(): boolean {
    return this.global;
  }

  public getSilent(): boolean {
    return this.silent;
  }

  public getSimulateCommands(): boolean {
    return this.simulateCommands;
  }

  public getSimulateSubagents(): boolean {
    return this.simulateSubagents;
  }

  public getSimulateSkills(): boolean {
    return this.simulateSkills;
  }

  public getModularMcp(): boolean {
    return this.modularMcp;
  }

  public getDryRun(): boolean {
    return this.dryRun;
  }

  public getCheck(): boolean {
    return this.check;
  }

  /**
   * Returns true if either dry-run or check mode is enabled.
   * In both modes, no files should be written.
   */
  public isPreviewMode(): boolean {
    return this.dryRun || this.check;
  }
}
