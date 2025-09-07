import { ALL_FEATURES, Features, RulesyncFeatures } from "../types/features.js";
import { ALL_TOOL_TARGETS, RulesyncTargets, ToolTargets } from "../types/tool-targets.js";

export type ConfigParams = {
  baseDirs: string[];
  targets: RulesyncTargets;
  features: RulesyncFeatures;
  verbose: boolean;
  delete: boolean;
  experimentalSimulateCommands: boolean;
  experimentalSimulateSubagents: boolean;
};

export class Config {
  private readonly baseDirs: string[];
  private readonly targets: RulesyncTargets;
  private readonly features: RulesyncFeatures;
  private readonly verbose: boolean;
  private readonly delete: boolean;
  private readonly experimentalSimulateCommands: boolean;
  private readonly experimentalSimulateSubagents: boolean;

  constructor({
    baseDirs,
    targets,
    features,
    verbose,
    delete: isDelete,
    experimentalSimulateCommands,
    experimentalSimulateSubagents,
  }: ConfigParams) {
    this.baseDirs = baseDirs;
    this.targets = targets;
    this.features = features;
    this.verbose = verbose;
    this.delete = isDelete;
    this.experimentalSimulateCommands = experimentalSimulateCommands;
    this.experimentalSimulateSubagents = experimentalSimulateSubagents;
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

  public getExperimentalSimulateCommands(): boolean {
    return this.experimentalSimulateCommands;
  }

  public getExperimentalSimulateSubagents(): boolean {
    return this.experimentalSimulateSubagents;
  }
}
