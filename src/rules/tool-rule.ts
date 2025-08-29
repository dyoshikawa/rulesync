import { AiFile, AiFileFromFilePathParams, AiFileParams } from "../types/ai-file.js";
import { RulesyncRule } from "./rulesync-rule.js";

export type ToolRuleParams = AiFileParams & {
  root?: boolean;
};

export type ToolRuleFromRulesyncRuleParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncRule: RulesyncRule;
};

export abstract class ToolRule extends AiFile {
  protected readonly root: boolean;

  constructor({ root = false, ...rest }: ToolRuleParams) {
    super(rest);
    this.root = root;
  }

  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<ToolRule> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncRule(_params: ToolRuleFromRulesyncRuleParams): ToolRule {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncRule(): RulesyncRule;

  isRoot(): boolean {
    return this.root;
  }
}
