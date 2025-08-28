import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { type AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, type ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type OpenCodeRuleParams = Omit<AiFileParams, "fileContent"> & {
  body: string;
  fileContent?: string;
};

export class OpenCodeRule extends ToolRule {
  private readonly body: string;

  constructor({ body, fileContent, ...rest }: OpenCodeRuleParams) {
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
  }: AiFileFromFilePathParams): Promise<OpenCodeRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { content } = matter(fileContent);

    // If there's no frontmatter, gray-matter returns the entire content as content
    // If the original file had no frontmatter, use the original fileContent
    const body = content.trim() || fileContent.trim();

    return new OpenCodeRule({
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
  }: ToolRuleFromRulesyncRuleParams): OpenCodeRule {
    const body = rulesyncRule.getBody();
    const fileContent = body; // AGENTS.md is plain markdown without frontmatter

    return new OpenCodeRule({
      baseDir,
      relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body,
      fileContent,
      validate,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const frontmatter: RuleFrontmatter = {
      root: true,
      targets: ["opencode"],
      description: "OpenCode AGENTS.md instructions",
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
    // OpenCode rules are always valid since they use plain markdown format
    // Similar to AgentsMdRule, no complex frontmatter validation needed
    return { success: true, error: null };
  }

  /**
   * Get the output file path for the generated AGENTS.md file
   * OpenCode uses AGENTS.md in the project root
   */
  getOutputFilePath(): string {
    return "AGENTS.md";
  }

  /**
   * Get the content that should be written to the output file
   * OpenCode uses plain markdown format without frontmatter
   */
  getOutputContent(): string {
    return this.body;
  }

  getBody(): string {
    return this.body;
  }
}
