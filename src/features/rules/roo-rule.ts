import { join } from "node:path";

import { ROO_DIR } from "../../constants/roo-paths.js";
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

export type RooRuleParams = ToolRuleParams;

export type RooRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for Roo Code AI assistant
 *
 * Generates rule files for Roo Code's hierarchical rule system.
 * Supports plain Markdown without frontmatter, mode-specific rules,
 * and both directory-based and single-file configurations.
 *
 * - Project scope writes the non-root directory `.roo/rules/`.
 * - Global scope writes the same non-root directory resolved under the home
 *   directory (`~/.roo/rules/`), which Roo loads before workspace rules.
 *   @see https://roocodeinc.github.io/Roo-Code/features/custom-instructions
 */
export class RooRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): RooRuleSettablePaths {
    // The relative directory is identical for project and global scope; global
    // mode differs only by output root (the home directory), so `~/.roo/rules/`
    // is produced without a separate branch here.
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(ROO_DIR, "rules", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<RooRule> {
    const fileContent = await readFileContent(
      join(outputRoot, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath),
    );

    return new RooRule({
      outputRoot,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): RooRule {
    return new RooRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  /**
   * Extract mode slug from file path for mode-specific rules
   * Returns undefined for non-mode-specific rules
   */
  static extractModeFromPath(filePath: string): string | undefined {
    // Check for mode-specific patterns:
    // .roo/rules-{mode}/ or .roorules-{mode} or .clinerules-{mode}

    // Directory pattern: .roo/rules-{mode}/
    const directoryMatch = filePath.match(/\.roo\/rules-([a-zA-Z0-9-]+)\//);
    if (directoryMatch) {
      return directoryMatch[1];
    }

    // Single-file patterns: .roorules-{mode} or .clinerules-{mode}
    const singleFileMatch = filePath.match(/\.(roo|cline)rules-([a-zA-Z0-9-]+)$/);
    if (singleFileMatch) {
      return singleFileMatch[2];
    }

    return undefined;
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
  }: ToolRuleForDeletionParams): RooRule {
    return new RooRule({
      outputRoot,
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
      toolTarget: "roo",
    });
  }
}
