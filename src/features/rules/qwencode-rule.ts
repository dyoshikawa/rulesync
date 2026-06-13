import { join } from "node:path";

import {
  QWENCODE_DIR,
  QWENCODE_MEMORIES_DIR_PATH,
  QWENCODE_RULE_FILE_NAME,
} from "../../constants/qwencode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type QwencodeRuleParams = ToolRuleParams;

export type QwencodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for Qwen Code AI assistant
 *
 * Generates QWEN.md memory files based on rulesync rule content.
 * Supports the Qwen Code context management system with hierarchical discovery.
 */
export class QwencodeRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): QwencodeRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: QWENCODE_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(QWENCODE_DIR, "memories", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<QwencodeRule> {
    const isRoot = relativeFilePath === QWENCODE_RULE_FILE_NAME;
    const relativePath = isRoot ? QWENCODE_RULE_FILE_NAME : join(QWENCODE_MEMORIES_DIR_PATH, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new QwencodeRule({
      outputRoot,
      relativeDirPath: isRoot
        ? this.getSettablePaths().root.relativeDirPath
        : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? QWENCODE_RULE_FILE_NAME : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): QwencodeRule {
    const { outputRoot = process.cwd(), rulesyncRule, validate = true } = params;
    return new QwencodeRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): QwencodeRule {
    const isRoot = relativeFilePath === QWENCODE_RULE_FILE_NAME && relativeDirPath === ".";

    return new QwencodeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "qwencode",
    });
  }
}
