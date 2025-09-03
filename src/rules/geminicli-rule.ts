import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
} from "./tool-rule.js";

export type GeminiCliRuleParams = ToolRuleParams;

/**
 * Represents a rule file for Gemini CLI
 * Gemini CLI uses plain markdown files (GEMINI.md) without frontmatter
 */
export class GeminiCliRule extends ToolRule {
  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<GeminiCliRule> {
    const fileContent = await readFileContent(join(baseDir, relativeFilePath));

    const isRoot = relativeFilePath === "GEMINI.md";

    return new GeminiCliRule({
      baseDir,
      relativeDirPath: isRoot ? "." : ".gemini/memories",
      relativeFilePath: isRoot ? "GEMINI.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): GeminiCliRule {
    return new GeminiCliRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: { relativeDirPath: ".", relativeFilePath: "GEMINI.md" },
        nonRootPath: { relativeDirPath: ".gemini/memories" },
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate() {
    // Gemini CLI uses plain markdown without frontmatter requirements
    // Validation always succeeds
    return { success: true as const, error: null };
  }
}
