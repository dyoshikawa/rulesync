import { join } from "node:path";

import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export class FactorySubagent extends SimulatedSubagent {
  static getSettablePaths(_options?: { global?: boolean }): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".factory", "droids"),
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<FactorySubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new FactorySubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new FactorySubagent(baseParams);
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "factory",
    });
  }

  static forDeletion(params: ToolSubagentForDeletionParams): FactorySubagent {
    return new FactorySubagent(this.forDeletionDefault(params));
  }
}
