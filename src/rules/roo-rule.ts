import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
} from "./tool-rule.js";

export type RooRuleParams = ToolRuleParams;

/**
 * Rule generator for Roo Code AI assistant
 *
 * Generates rule files for Roo Code's hierarchical rule system.
 * Supports plain Markdown without frontmatter, mode-specific rules,
 * and both directory-based and single-file configurations.
 */
export class RooRule extends ToolRule {
  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<RooRule> {
    const fileContent = await readFileContent(join(baseDir, ".roo/rules", relativeFilePath));

    return new RooRule({
      baseDir,
      relativeDirPath: ".roo/rules",
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): RooRule {
    return new RooRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: { relativeDirPath: ".roo/rules" },
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
}
