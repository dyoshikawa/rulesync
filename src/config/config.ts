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
  simulatedCommands: optional(z.boolean()),
  simulatedSubagents: optional(z.boolean()),
  simulatedSkills: optional(z.boolean()),
  modularMcp: optional(z.boolean()),
  // Deprecated experimental options (for backward compatibility)
  experimentalGlobal: optional(z.boolean()),
  experimentalSimulateCommands: optional(z.boolean()),
  experimentalSimulateSubagents: optional(z.boolean()),
});
export type ConfigParams = z.infer<typeof ConfigParamsSchema>;

export const PartialConfigParamsSchema = z.partial(ConfigParamsSchema);
export type PartialConfigParams = z.infer<typeof PartialConfigParamsSchema>;

export const RequiredConfigParamsSchema = z.required(ConfigParamsSchema);
export type RequiredConfigParams = z.infer<typeof RequiredConfigParamsSchema>;

export class Config {
  private readonly baseDirs: string[];
  private readonly targets: RulesyncTargets;
  private readonly features: RulesyncFeatures;
  private readonly verbose: boolean;
  private readonly delete: boolean;
  private readonly global: boolean;
  private readonly simulatedCommands: boolean;
  private readonly simulatedSubagents: boolean;
  private readonly simulatedSkills: boolean;
  private readonly modularMcp: boolean;

  constructor({
    baseDirs,
    targets,
    features,
    verbose,
    delete: isDelete,
    global,
    simulatedCommands,
    simulatedSubagents,
    simulatedSkills,
    modularMcp,
    experimentalGlobal,
    experimentalSimulateCommands,
    experimentalSimulateSubagents,
  }: ConfigParams) {
    this.baseDirs = baseDirs;
    this.targets = targets;
    this.features = features;
    this.verbose = verbose;
    this.delete = isDelete;

    // Migration logic: prefer new options over experimental ones
    this.global = global ?? experimentalGlobal ?? false;
    this.simulatedCommands = simulatedCommands ?? experimentalSimulateCommands ?? false;
    this.simulatedSubagents = simulatedSubagents ?? experimentalSimulateSubagents ?? false;
    this.simulatedSkills = simulatedSkills ?? false;
    this.modularMcp = modularMcp ?? false;
  }

  public getBaseDirs(): string[] {
    return this.baseDirs;
  }

  public getTargets(): ToolTargets {
    if (this.targets.includes("*")) {
      return [...ALL_TOOL_TARGETS];
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

  public getSimulatedCommands(): boolean {
    return this.simulatedCommands;
  }

  public getSimulatedSubagents(): boolean {
    return this.simulatedSubagents;
  }

  public getSimulatedSkills(): boolean {
    return this.simulatedSkills;
  }

  public getModularMcp(): boolean {
    return this.modularMcp;
  }

  // Deprecated getters for backward compatibility
  /** @deprecated Use getGlobal() instead */
  public getExperimentalGlobal(): boolean {
    return this.global;
  }

  /** @deprecated Use getSimulatedCommands() instead */
  public getExperimentalSimulateCommands(): boolean {
    return this.simulatedCommands;
  }

  /** @deprecated Use getSimulatedSubagents() instead */
  public getExperimentalSimulateSubagents(): boolean {
    return this.simulatedSubagents;
  }
}
