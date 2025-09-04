import { join } from "node:path";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromFileParams, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type JunieRuleParams = AiFileParams;

/**
 * Rule generator for JetBrains Junie AI coding agent
 *
 * Generates .junie/guidelines.md files based on rulesync rule content.
 * Junie uses plain markdown format without frontmatter requirements.
 */
export class JunieRule extends ToolRule {
  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<JunieRule> {
    const fileContent = await readFileContent(join(baseDir, relativeFilePath));

    const isRoot = relativeFilePath === "guidelines.md";

    return new JunieRule({
      baseDir,
      relativeDirPath: isRoot ? ".junie" : ".junie/memories",
      relativeFilePath: isRoot ? "guidelines.md" : relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): JunieRule {
    return new JunieRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: { relativeDirPath: ".junie", relativeFilePath: "guidelines.md" },
        nonRootPath: { relativeDirPath: ".junie/memories" },
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // Junie rules are always valid since they don't require frontmatter
    return { success: true, error: null };
  }
}
