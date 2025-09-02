import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { logger } from "../utils/logger.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type WindsurfRuleParams = ToolRuleParams;

/**
 * WindsurfRule - Windsurf AI Code Editor rules configuration
 *
 * Handles Windsurf-specific rule files with support for:
 * - Global rules in ~/.codeium/windsurf/memories/global_rules.md
 * - Workspace rules in .windsurf-rules or .windsurf/rules/
 * - Activation modes (always, manual, model-decision, glob)
 */
export class WindsurfRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<WindsurfRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    return new WindsurfRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    return new WindsurfRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: { relativeDirPath: ".windsurf/rules" },
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
