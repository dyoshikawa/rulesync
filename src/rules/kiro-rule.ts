import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type KiroRuleParams = ToolRuleParams;

/**
 * Rule generator for Kiro AI-powered IDE
 *
 * Generates steering documents for Kiro's spec-driven development approach.
 * Supports both root file (.kiro/guidelines.md) and steering documents
 * in the .kiro/steering/ directory (product.md, structure.md, tech.md).
 */
export class KiroRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<KiroRule> {
    const fileContent = await readFileContent(params.filePath);

    return new KiroRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      validate: params.validate ?? true,
      root: false,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): KiroRule {
    return new KiroRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: { relativeDirPath: ".kiro/steering" },
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
