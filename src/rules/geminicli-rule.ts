import { AiFileFromFilePathParams } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type GeminiCliRuleParams = ToolRuleParams;

/**
 * Represents a rule file for Gemini CLI
 * Gemini CLI uses plain markdown files (GEMINI.md) without frontmatter
 */
export class GeminiCliRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<GeminiCliRule> {
    const fileContent = await readFileContent(params.filePath);

    return new GeminiCliRule({
      baseDir: params.baseDir || process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      validate: params.validate ?? true,
      root: params.relativeFilePath === "GEMINI.md",
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
