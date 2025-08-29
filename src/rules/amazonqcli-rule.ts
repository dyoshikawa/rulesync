import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export interface AmazonQCliRuleParams extends ToolRuleParams {
  body: string;
}

export class AmazonQCliRule extends ToolRule {
  private readonly body: string;

  constructor(params: AmazonQCliRuleParams) {
    super({
      ...params,
    });

    this.body = params.body;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<AmazonQCliRule> {
    const fileContent = await readFile(params.filePath, "utf8");
    const { content } = matter(fileContent);

    // If there's no frontmatter, gray-matter returns the entire content as content
    // If the original file had no frontmatter, use the original fileContent
    const body = content.trim() || fileContent.trim();

    return new AmazonQCliRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      body,
      validate: params.validate ?? true,
      root: params.relativeFilePath === "main.md",
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): AmazonQCliRule {
    const { rulesyncRule, ...rest } = params;

    const root = rulesyncRule.getFrontmatter().root;
    const body = rulesyncRule.getBody();
    const fileContent = body; // Amazon Q CLI rules are plain markdown without frontmatter

    if (root) {
      return new AmazonQCliRule({
        ...rest,
        fileContent,
        relativeFilePath: "main.md",
        body,
        root,
      });
    }

    return new AmazonQCliRule({
      ...rest,
      fileContent,
      relativeDirPath: join(".amazonq", "rules"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: this.root,
      targets: ["amazonqcli"],
      description: "Amazon Q Developer CLI rules",
      globs: ["**/*"],
    };

    // Amazon Q CLI rules use plain markdown content
    const fileContent = matter.stringify(this.body, rulesyncFrontmatter);

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      fileContent,
      validate: false,
    });
  }

  validate(): ValidationResult {
    // Amazon Q CLI rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }

  getBody(): string {
    return this.body;
  }
}
