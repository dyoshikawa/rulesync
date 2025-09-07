import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export class CursorSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "CURSOR.md",
      },
      nonRoot: {
        relativeDirPath: ".cursor/subagents",
      },
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<CursorSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new CursorSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new CursorSubagent(baseParams);
  }
}
