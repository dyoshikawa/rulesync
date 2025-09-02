import { readFile } from "node:fs/promises";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type WindsurfRuleParams = ToolRuleParams;
export class WindsurfRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<WindsurfRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    return new WindsurfRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    return new WindsurfRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: { relativeDirPath: ".windsurf/rules" },
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
