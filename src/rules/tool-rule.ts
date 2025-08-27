import { AiFile, AiFileFromFilePathParams, AiFileParams } from "../types/ai-file.js";
import { RulesyncRule } from "./rulesync-rule.js";

export type ToolRuleFromRulesyncRuleParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncRule: RulesyncRule;
};

export abstract class ToolRule extends AiFile {
  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<ToolRule> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncRule(_params: ToolRuleFromRulesyncRuleParams): ToolRule {
    throw new Error("Please implement this method in the subclass.");
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  abstract toRulesyncRule(): RulesyncRule;
}
