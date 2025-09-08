import { AiFileFromFileParams, AiFileParams } from "../types/ai-file.js";
import { ToolFile } from "../types/tool-file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

export type ToolSubagentFromRulesyncSubagentParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncSubagent: RulesyncSubagent;
};

export type ToolSubagentSettablePaths = {
  relativeDirPath: string;
};

export type ToolSubagentFromFileParams = AiFileFromFileParams;
export abstract class ToolSubagent extends ToolFile {
  static getSettablePaths(): ToolSubagentSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  static async fromFile(_params: ToolSubagentFromFileParams): Promise<ToolSubagent> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncSubagent(_params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncSubagent(): RulesyncSubagent;
}
