import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type QwencodeRuleParams = ToolRuleParams;

/**
 * Rule generator for Qwen Code AI assistant
 *
 * Generates QWEN.md memory files based on rulesync rule content.
 * Supports the Qwen Code context management system with hierarchical discovery.
 */
export class QwencodeRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<QwencodeRule> {
    const fileContent = await readFileContent(params.filePath);

    return new QwencodeRule({
      baseDir: params.baseDir || process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      validate: params.validate ?? true,
      root: params.relativeFilePath === "QWEN.md",
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
