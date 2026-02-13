import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type ReplitRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

/**
 * Rule generator for Replit Agent
 *
 * Generates replit.md files based on rulesync rule content.
 * This is a simple root-only implementation that only supports
 * importing the root replit.md file.
 */
export class ReplitRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): ReplitRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "replit.md",
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<ReplitRule> {
    const paths = this.getSettablePaths();
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (!isRoot) {
      throw new Error(`ReplitRule only supports root rules: ${relativeFilePath}`);
    }

    const relativePath = paths.root.relativeFilePath;
    const fileContent = await readFileContent(
      join(baseDir, paths.root.relativeDirPath, relativePath),
    );

    return new ReplitRule({
      baseDir,
      relativeDirPath: paths.root.relativeDirPath,
      relativeFilePath: paths.root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ReplitRule {
    const paths = this.getSettablePaths();

    // Only support root rules
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      throw new Error(`ReplitRule only supports root rules: ${rulesyncRule.getRelativeFilePath()}`);
    }

    return new ReplitRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: undefined,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // Replit Agent rules are always valid since they don't have complex frontmatter
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): ReplitRule {
    const paths = this.getSettablePaths();
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new ReplitRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    // Only root rules are targeted
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      return false;
    }

    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "replit",
    });
  }
}
