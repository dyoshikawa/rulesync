import { ALL_FEATURES, Features, RulesyncFeatures } from "../types/features.js";
import { ALL_TOOL_TARGETS, RulesyncTargets, ToolTargets } from "../types/tool-targets.js";

export type ConfigParams = {
  baseDirs: string[];
  targets: RulesyncTargets;
  features: RulesyncFeatures;
  verbose: boolean;
  delete: boolean;
  // New non-experimental options
  global?: boolean;
  simulatedCommands?: boolean;
  simulatedSubagents?: boolean;
  // Deprecated experimental options (for backward compatibility)
  experimentalGlobal?: boolean;
  experimentalSimulateCommands?: boolean;
  experimentalSimulateSubagents?: boolean;
};

export class Config {
  private readonly baseDirs: string[];
  private readonly targets: RulesyncTargets;
  private readonly features: RulesyncFeatures;
  private readonly verbose: boolean;
  private readonly delete: boolean;
  private readonly global: boolean;
  private readonly simulatedCommands: boolean;
  private readonly simulatedSubagents: boolean;

  constructor({
    baseDirs,
    targets,
    features,
    verbose,
    delete: isDelete,
    global,
    simulatedCommands,
    simulatedSubagents,
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
