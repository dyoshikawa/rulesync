import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export class GeminiCliSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: ".gemini/subagents",
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<GeminiCliSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new GeminiCliSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new GeminiCliSubagent(baseParams);
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "geminicli",
    });
  }
}
