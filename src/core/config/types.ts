import { RulesyncFeatures } from "../../types/features.js";
import type { RulesyncTargets } from "../../types/index.js";

export interface CliOptions {
  targets?: RulesyncTargets;
  features?: RulesyncFeatures;
  verbose?: boolean;
  delete?: boolean;
  baseDirs?: string[];
  config?: string;
}
