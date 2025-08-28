import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type AgentsMdRuleParams = Omit<AiFileParams, "fileContent"> & {
  body: string;
  fileContent?: string;
};

export class AgentsMdRule extends ToolRule {
  private readonly body: string;

  constructor({ body, fileContent, ...rest }: AgentsMdRuleParams) {
    const actualFileContent = fileContent || body;

    super({
      ...rest,
      fileContent: actualFileContent,
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
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    relativeDirPath,
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AgentsMdRule {
    const body = rulesyncRule.getBody();
    const fileContent = body; // AGENTS.md is plain markdown without frontmatter

    return new AgentsMdRule({
      baseDir,
      relativeDirPath,
      relativeFilePath: "AGENTS.md",
      body,
      fileContent,
      validate,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const frontmatter = {
      root: true,
      targets: ["agentsmd" as const],
      description: "AGENTS.md instructions",
      globs: ["**/*"],
    };

    // AGENTS.md uses plain markdown content
    const fileContent = matter.stringify(this.body, frontmatter);

    return new RulesyncRule({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      frontmatter,
      body: this.body,
      fileContent,
      validate: false,
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
