import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export type AmazonQCliRuleParams = ToolRuleParams;

export class AmazonQCliRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<AmazonQCliRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    return new AmazonQCliRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      validate: params.validate ?? false,
      root: false,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): AmazonQCliRule {
    const { rulesyncRule, ...rest } = params;

    const root = rulesyncRule.getFrontmatter().root;
    const fileContent = rulesyncRule.getBody(); // Amazon Q CLI rules are plain markdown without frontmatter

    return new AmazonQCliRule({
      ...rest,
      fileContent,
      relativeDirPath: join(".amazonq", "rules"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return new RulesyncRule({
      frontmatter: {
        root: this.isRoot(),
        targets: ["amazonqcli"],
        description: "",
        globs: this.isRoot() ? ["**/*"] : [],
      },
      baseDir: this.getBaseDir(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      body: this.getFileContent(),
      validate: false,
    });
  }

  validate(): ValidationResult {
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }
}
