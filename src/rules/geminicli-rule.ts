import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type GeminiCliRuleParams = ToolRuleParams;

export type GeminiCliRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

/**
 * Represents a rule file for Gemini CLI
 * Gemini CLI uses plain markdown files (GEMINI.md) without frontmatter
 */
export class GeminiCliRule extends ToolRule {
  static getSettablePaths(): GeminiCliRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md",
      },
      nonRoot: {
        relativeDirPath: ".gemini/memories",
      },
    };
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<GeminiCliRule> {
    const isRoot = relativeFilePath === "GEMINI.md";
    const relativePath = isRoot ? "GEMINI.md" : join(".gemini/memories", relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new GeminiCliRule({
      baseDir,
      relativeDirPath: isRoot
        ? this.getSettablePaths().root.relativeDirPath
        : this.getSettablePaths().nonRoot.relativeDirPath,
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
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
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
