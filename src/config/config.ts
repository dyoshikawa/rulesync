import { optional, z } from "zod/mini";

import {
  ALL_FEATURES,
  Features,
  RulesyncFeatures,
  RulesyncFeaturesSchema,
} from "../types/features.js";
import {
  ALL_TOOL_TARGETS,
  RulesyncTargets,
  RulesyncTargetsSchema,
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
  }: ConfigParams) {
    // Validate conflicting targets
    this.validateConflictingTargets(targets);

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

  public getFeatures(): Features {
    if (this.features.includes("*")) {
      return [...ALL_FEATURES];
    }

    return this.features.filter((feature) => feature !== "*");
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
}
