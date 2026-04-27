import { join } from "node:path";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type JunieRuleParams = AiFileParams;

export type JunieRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for JetBrains Junie AI coding agent
 *
 * Generates .junie/guidelines.md files based on rulesync rule content.
 * Junie uses plain markdown format without frontmatter requirements.
 */
export class JunieRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): JunieRuleSettablePaths {
    return {
      root: {
        relativeDirPath: buildToolPath(".junie", ".", _options.excludeToolDir),
        relativeFilePath: "guidelines.md",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".junie", "memories", _options.excludeToolDir),
      },
    };
  }

  /**
   * Determines whether a given relative file path refers to the root
   * `guidelines.md` file. Memory files live under `.junie/memories/` and are
   * passed in as bare filenames (e.g. `memo.md`), so a top-level
   * `guidelines.md` is unambiguously the root entry.
   */
  private static isRootRelativeFilePath(relativeFilePath: string): boolean {
    return relativeFilePath === "guidelines.md";
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<JunieRule> {
    const isRoot = JunieRule.isRootRelativeFilePath(relativeFilePath);
    const settablePaths = this.getSettablePaths();
    const relativePath = isRoot
      ? join(settablePaths.root.relativeDirPath, settablePaths.root.relativeFilePath)
      : join(settablePaths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new JunieRule({
      outputRoot,
      relativeDirPath: isRoot
        ? settablePaths.root.relativeDirPath
        : settablePaths.nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? settablePaths.root.relativeFilePath : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): JunieRule {
    return new JunieRule(
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
    // Junie rules are always valid since they don't require frontmatter
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): JunieRule {
    const isRoot = JunieRule.isRootRelativeFilePath(relativeFilePath);

    return new JunieRule({
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
      toolTarget: "junie",
    });
  }
}
