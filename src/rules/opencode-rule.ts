import { join } from "node:path";
import { type AiFileFromFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, type ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type OpenCodeRuleParams = ToolRuleParams;

export class OpenCodeRule extends ToolRule {
  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: AiFileFromFileParams): Promise<OpenCodeRule> {
    const isRoot = relativeFilePath === "AGENTS.md";
    const relativePath = isRoot ? "AGENTS.md" : join(".opencode/memories", relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new OpenCodeRule({
      baseDir,
      relativeDirPath: isRoot ? "." : ".opencode/memories",
      relativeFilePath: isRoot ? "AGENTS.md" : relativeFilePath,
      validate,
      root: isRoot,
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
