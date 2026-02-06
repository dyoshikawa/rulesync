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
  buildToolPath,
} from "./tool-rule.js";

export type KiloRuleSettablePaths = Pick<ToolRuleSettablePaths, "nonRoot">;

/**
 * Rule generator for Kilo Code
 *
 * Generates Markdown rule files for Kilo Code's custom rules system.
 * Supports both project-level and global rules using the `.kilocode/rules` directory.
 */
export class KiloRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): KiloRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".kilocode", "rules", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<KiloRule> {
    const fileContent = await readFileContent(
      join(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath),
    );

    return new KiloRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): KiloRule {
    return new KiloRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
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
  }: ToolRuleForDeletionParams): KiloRule {
    return new KiloRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kilo",
    });
  }
}
