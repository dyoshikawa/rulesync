import { readFile } from "node:fs/promises";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type JunieRuleParams = AiFileParams;

/**
 * Rule generator for JetBrains Junie AI coding agent
 *
 * Generates .junie/guidelines.md files based on rulesync rule content.
 * Junie uses plain markdown format without frontmatter requirements.
 */
export class JunieRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<JunieRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    return new JunieRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      validate: params.validate ?? true,
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
        rootPath: { relativeDirPath: ".", relativeFilePath: "guidelines.md" },
        nonRootPath: { relativeDirPath: ".junie/guidelines" },
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
