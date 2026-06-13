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
} from "./tool-rule.js";

export type VibeRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export type VibeRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

export class VibeRule extends ToolRule {
  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): VibeRuleSettablePaths | VibeRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: ".vibe",
          relativeFilePath: "AGENTS.md",
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<VibeRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (!isRoot) {
      throw new Error(`VibeRule only supports root rules: ${relativeFilePath}`);
    }

    const fileContent = await readFileContent(
      join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
    );

    return new VibeRule({
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
  }: ToolRuleFromRulesyncRuleParams): VibeRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      throw new Error(`VibeRule only supports root rules: ${rulesyncRule.getRelativeFilePath()}`);
    }

    return new VibeRule(
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
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): VibeRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new VibeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      return false;
    }

    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "vibe",
    });
  }
}
