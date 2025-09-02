import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { type AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, type ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type OpenCodeRuleParams = ToolRuleParams;

export class OpenCodeRule extends ToolRule {
  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<OpenCodeRule> {
    const fileContent = await readFile(filePath, "utf-8");

    return new OpenCodeRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      validate,
      root: relativeFilePath === "AGENTS.md",
      fileContent,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): OpenCodeRule {
    return new OpenCodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // OpenCode rules are always valid since they use plain markdown format
    // Similar to AgentsMdRule, no complex frontmatter validation needed
    return { success: true, error: null };
  }
}
