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

export type QwencodeRuleSettablePaths =
  | (Omit<ToolRuleSettablePaths, "root"> & {
      root: {
        relativeDirPath: string;
        relativeFilePath: string;
      };
      nonRoot: {
        relativeDirPath: string;
      };
    })
  | {
      root: {
        relativeDirPath: string;
        relativeFilePath: string;
      };
      nonRoot?: undefined;
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
    // Global scope: the root memory file lives under `~/.qwen/QWEN.md`. Qwen
    // Code does not document a global non-root memories directory, so only the
    // root path is emitted (mirrors how geminicli global rules are wired).
    if (_options.global) {
      return {
        root: {
          relativeDirPath: buildToolPath(QWENCODE_DIR, ".", _options.excludeToolDir),
          relativeFilePath: QWENCODE_RULE_FILE_NAME,
        },
      };
    }
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
    global = false,
  }: ToolRuleFromFileParams): Promise<QwencodeRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === QWENCODE_RULE_FILE_NAME;

    if (isRoot) {
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, QWENCODE_RULE_FILE_NAME),
      );
      return new QwencodeRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: QWENCODE_RULE_FILE_NAME,
        fileContent,
        validate,
        root: true,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const relativePath = join(QWENCODE_MEMORIES_DIR_PATH, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new QwencodeRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): QwencodeRule {
    const { outputRoot = process.cwd(), rulesyncRule, validate = true, global = false } = params;
    const paths = this.getSettablePaths({ global });
    return new QwencodeRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot,
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
