import { z } from "zod/mini";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const ClineRuleFrontmatterSchema = z.object({
  description: z.string(),
});

export type ClineRuleFrontmatter = z.infer<typeof ClineRuleFrontmatterSchema>;

export class ClineRule extends ToolRule {
  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    return new ClineRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: { relativeDirPath: ".clinerules" },
      }),
    );
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<ClineRule> {
    // Read file content
    const fileContent = await readFileContent(filePath);

    return new ClineRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
    });
  }
}
