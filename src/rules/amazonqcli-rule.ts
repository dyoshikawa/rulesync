import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type AmazonQCliRuleParams = ToolRuleParams;

export class AmazonQCliRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<AmazonQCliRule> {
    const fileContent = await readFileContent(params.filePath);

    return new AmazonQCliRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      validate: params.validate ?? false,
      root: false,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AmazonQCliRule {
    return new AmazonQCliRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: { relativeDirPath: ".amazonq/rules" },
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }
}
