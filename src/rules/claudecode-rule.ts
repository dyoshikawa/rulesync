import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromFileParams, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

/**
 * Rule generator for Claude Code AI assistant
 *
 * Generates CLAUDE.md memory files based on rulesync rule content.
 * Supports the Claude Code memory system with import references.
 */
export class ClaudecodeRule extends ToolRule {
  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<ClaudecodeRule> {
    const fileContent = await readFileContent(join(baseDir, relativeFilePath));

    const isRoot = relativeFilePath === "CLAUDE.md";

    return new ClaudecodeRule({
      baseDir,
      relativeDirPath: isRoot ? "." : ".claude/memories",
      relativeFilePath: isRoot ? "CLAUDE.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    return new ClaudecodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: { relativeDirPath: ".", relativeFilePath: "CLAUDE.md" },
        nonRootPath: { relativeDirPath: ".claude/memories" },
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
