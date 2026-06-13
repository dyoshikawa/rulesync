import { ROO_SUBAGENTS_DIR_PATH } from "../../constants/roo-paths.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export class RooSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: ROO_SUBAGENTS_DIR_PATH,
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<RooSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new RooSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new RooSubagent(baseParams);
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "roo",
    });
  }

  static forDeletion(params: ToolSubagentForDeletionParams): RooSubagent {
    return new RooSubagent(this.forDeletionDefault(params));
  }
}
