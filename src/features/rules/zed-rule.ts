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
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type ZedRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export type ZedRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for the Zed editor.
 *
 * Zed reads a single project rules file (the first match in its priority list,
 * of which `.rules` is the highest-priority, Zed-specific entry) and a single
 * global rules file at `~/.config/zed/AGENTS.md`. Because Zed loads exactly one
 * file, only root rules are supported; non-root rules cannot be represented.
 */
export class ZedRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ZedRuleSettablePaths | ZedRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(join(".config", "zed"), ".", excludeToolDir),
          relativeFilePath: "AGENTS.md",
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: ".rules",
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<ZedRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (!isRoot) {
      throw new Error(`ZedRule only supports root rules: ${relativeFilePath}`);
    }

    const fileContent = await readFileContent(
      join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
    );

    return new ZedRule({
      outputRoot,
      relativeDirPath: paths.root.relativeDirPath,
      relativeFilePath: paths.root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ZedRule {
    const paths = this.getSettablePaths({ global });

    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      throw new Error(`ZedRule only supports root rules: ${rulesyncRule.getRelativeFilePath()}`);
    }

    return new ZedRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
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
    // Zed rules are plain markdown without frontmatter requirements.
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): ZedRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new ZedRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    // Only root rules are targeted; Zed reads a single rules file.
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      return false;
    }

    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "zed",
    });
  }
}
