import { AiFileFromFilePathParams, AiFileParams } from "../types/ai-file.js";
import { ToolFile } from "../types/tool-file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

export type ToolSubagentFromRulesyncSubagentParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncSubagent: RulesyncSubagent;
};

export abstract class ToolSubagent extends ToolFile {
  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<ToolSubagent> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncSubagent(_params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncSubagent(): RulesyncSubagent;
}
