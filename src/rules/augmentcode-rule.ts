import { join } from "node:path";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromFileParams, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

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

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AugmentcodeRule> {
    const fileContent = await readFileContent(join(baseDir, ".augment/rules", relativeFilePath));
    const { body: content } = parseFrontmatter(fileContent);

    return new AugmentcodeRule({
      baseDir: baseDir,
      relativeDirPath: ".augment/rules",
      relativeFilePath: relativeFilePath,
      fileContent: content.trim(),
      validate,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
