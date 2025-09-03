import { join } from "node:path";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromFileParams, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

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

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<ClineRule> {
    // Read file content
    const fileContent = await readFileContent(join(baseDir, relativeFilePath));

    return new ClineRule({
      baseDir: baseDir,
      relativeDirPath: ".clinerules",
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
    });
  }
}
