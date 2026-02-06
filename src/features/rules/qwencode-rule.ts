import { join } from "node:path";

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
        relativeFilePath: "QWEN.md",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".qwen", "memories", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<QwencodeRule> {
    const isRoot = relativeFilePath === "QWEN.md";
    const relativePath = isRoot ? "QWEN.md" : join(".qwen", "memories", relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new QwencodeRule({
      baseDir,
      relativeDirPath: isRoot
        ? this.getSettablePaths().root.relativeDirPath
        : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "QWEN.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): QwencodeRule {
    const { baseDir = process.cwd(), rulesyncRule, validate = true } = params;
    return new QwencodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
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
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): QwencodeRule {
    const isRoot = relativeFilePath === "QWEN.md" && relativeDirPath === ".";

    return new QwencodeRule({
      baseDir,
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
