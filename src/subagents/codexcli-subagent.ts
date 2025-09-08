import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export class CodexCliSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: ".codex/subagents",
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<CodexCliSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new CodexCliSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new CodexCliSubagent(baseParams);
  }
}
