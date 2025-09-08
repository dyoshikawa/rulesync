import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export class CopilotSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: ".copilot/subagents",
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<CopilotSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new CopilotSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new CopilotSubagent(baseParams);
  }
}
