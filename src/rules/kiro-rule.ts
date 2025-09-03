import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
} from "./tool-rule.js";

export type KiroRuleParams = ToolRuleParams;

/**
 * Rule generator for Kiro AI-powered IDE
 *
 * Generates steering documents for Kiro's spec-driven development approach.
 * Supports both root file (.kiro/guidelines.md) and steering documents
 * in the .kiro/steering/ directory (product.md, structure.md, tech.md).
 */
export class KiroRule extends ToolRule {
  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<KiroRule> {
    const fileContent = await readFileContent(join(baseDir, relativeFilePath));

    return new KiroRule({
      baseDir,
      relativeDirPath: ".kiro/steering",
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
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
