import { ALL_FEATURES, RulesyncFeatures } from "../types/features.js";
import { ALL_TOOL_TARGETS, RulesyncTargets } from "../types/tool-targets.js";

export interface ConfigParams {
  baseDirs: string[];
  targets: RulesyncTargets;
  features: RulesyncFeatures;
  verbose: boolean;
  delete: boolean;
}

export class Config {
  private readonly baseDirs: string[];
  private readonly targets: RulesyncTargets;
  private readonly features: RulesyncFeatures;
  private readonly verbose: boolean;
  private readonly delete: boolean;

  constructor({ baseDirs, targets, features, verbose, delete: isDelete }: ConfigParams) {
    this.baseDirs = baseDirs;
    this.targets = targets;
    this.features = features;
    this.verbose = verbose;
    this.delete = isDelete;
  }

  public getBaseDirs(): string[] {
    return this.baseDirs;
  }

  public getTargets(): RulesyncTargets {
    if (this.targets.includes("*")) {
      return [...ALL_TOOL_TARGETS];
    }

    return this.targets;
  }

  public getFeatures(): RulesyncFeatures {
    if (this.features.includes("*")) {
      return [...ALL_FEATURES];
    }

    return this.features;
  }

  public getVerbose(): boolean {
    return this.verbose;
  }

  public getDelete(): boolean {
    return this.delete;
  }
}
