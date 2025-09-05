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

export type QwencodeRuleParams = ToolRuleParams;

/**
 * Rule generator for Qwen Code AI assistant
 *
 * Generates QWEN.md memory files based on rulesync rule content.
 * Supports the Qwen Code context management system with hierarchical discovery.
 */
export class QwencodeRule extends ToolRule {
  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<QwencodeRule> {
    const isRoot = relativeFilePath === "QWEN.md";
    const relativePath = isRoot ? "QWEN.md" : join(".qwencode/memories", relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new QwencodeRule({
      baseDir,
      relativeDirPath: isRoot ? "." : ".qwencode/memories",
      relativeFilePath: isRoot ? "QWEN.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): QwencodeRule {
    const { rulesyncRule } = params;
    return new QwencodeRule(
      this.buildToolRuleParamsDefault({
        rulesyncRule,
        validate: params.validate ?? true,
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
