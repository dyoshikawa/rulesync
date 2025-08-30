import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const ClineRuleFrontmatterSchema = z.object({
  description: z.string(),
});

export type ClineRuleFrontmatter = z.infer<typeof ClineRuleFrontmatterSchema>;

export class ClineRule extends ToolRule {
  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets: ["*"],
      root: this.isRoot(),
      description: "",
      globs: this.isRoot() ? ["**/*"] : [],
    };

    return new RulesyncRule({
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      baseDir: this.getBaseDir(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      validate: false,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    return new ClineRule({
      baseDir: baseDir,
      relativeDirPath: ".clinerules",
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      fileContent: rulesyncRule.getBody(),
      validate,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<ClineRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");

    return new ClineRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
    });
  }
}
