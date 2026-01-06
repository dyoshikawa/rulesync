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
} from "./tool-rule.js";

export type KiroCliRuleParams = ToolRuleParams;

export type KiroCliRuleSettablePaths = ToolRuleSettablePaths;

/**
 * Rule generator for Kiro CLI
 *
 * Generates steering documents for Kiro CLI's agent configurations.
 * All steering files (both root and non-root) are placed in .kiro/steering/ directory.
 */
export class KiroCliRule extends ToolRule {
  static getSettablePaths(): KiroCliRuleSettablePaths {
    return {
      root: {
        relativeDirPath: join(".kiro", "steering"),
        relativeFilePath: "product.md",
      },
      nonRoot: {
        relativeDirPath: join(".kiro", "steering"),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<KiroCliRule> {
    const fileContent = await readFileContent(
      join(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath),
    );

    return new KiroCliRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): KiroCliRule {
    return new KiroCliRule(
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
  }: ToolRuleForDeletionParams): KiroCliRule {
    return new KiroCliRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kirocli",
    });
  }
}
