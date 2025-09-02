import matter from "gray-matter";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type AugmentcodeRuleParams = AiFileParams;

export class AugmentcodeRule extends ToolRule {
  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AugmentcodeRule {
    return new AugmentcodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: { relativeDirPath: ".augment/rules" },
      }),
    );
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<AugmentcodeRule> {
    const fileContent = await readFileContent(filePath);
    const { content } = matter(fileContent);

    return new AugmentcodeRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent: content.trim(),
      validate,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
