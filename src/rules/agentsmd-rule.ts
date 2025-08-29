import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type AgentsMdRuleParams = Omit<AiFileParams, "fileContent"> & {
  body: string;
  fileContent?: string;
  root?: boolean;
};

export class AgentsMdRule extends ToolRule {
  private readonly body: string;

  constructor({ body, fileContent, root, ...rest }: AgentsMdRuleParams) {
    const actualFileContent = fileContent || body;

    super({
      ...rest,
      fileContent: actualFileContent,
      root: root ?? false,
    });

    this.body = body;
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<AgentsMdRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { content } = matter(fileContent);

    // If there's no frontmatter, gray-matter returns the entire content as content
    // If the original file had no frontmatter, use the original fileContent
    const body = content.trim() || fileContent.trim();

    return new AgentsMdRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      body,
      fileContent,
      validate,
      root: relativeFilePath === "AGENTS.md",
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    relativeDirPath,
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AgentsMdRule {
    const root = rulesyncRule.getFrontmatter().root;
    const body = rulesyncRule.getBody();
    const fileContent = body; // AGENTS.md is plain markdown without frontmatter

    if (root) {
      return new AgentsMdRule({
        baseDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        body,
        fileContent,
        validate,
        root,
      });
    }

    return new AgentsMdRule({
      baseDir,
      relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body,
      fileContent,
      validate,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: this.isRoot(),
      targets: ["agentsmd"],
      description: "AGENTS.md instructions",
      globs: ["**/*"],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      fileContent: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    // AGENTS.md rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }

  getBody(): string {
    return this.body;
  }
}
