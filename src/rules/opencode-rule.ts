import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { type AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, type ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type OpenCodeRuleParams = Omit<AiFileParams, "fileContent"> & {
  body: string;
  fileContent?: string;
  root?: boolean;
};

export class OpenCodeRule extends ToolRule {
  private readonly body: string;

  constructor({ body, fileContent, root = false, ...rest }: OpenCodeRuleParams) {
    const actualFileContent = fileContent || body;

    super({
      ...rest,
      fileContent: actualFileContent,
      root,
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
      root: relativeFilePath === "AGENTS.md",
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    relativeDirPath: _relativeDirPath,
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): OpenCodeRule {
    const body = rulesyncRule.getBody();
    const fileContent = body;
    const root = rulesyncRule.getFrontmatter().root ?? false;

    if (root) {
      return new OpenCodeRule({
        baseDir,
        relativeDirPath: "",
        relativeFilePath: "AGENTS.md",
        body,
        fileContent,
        validate,
        root,
      });
    }

    return new OpenCodeRule({
      baseDir,
      relativeDirPath: join(".opencode", "memories"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body,
      fileContent,
      validate,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const frontmatter: RuleFrontmatter = {
      root: this.isRoot(),
      targets: ["opencode"],
      description: this.isRoot() ? "OpenCode AGENTS.md instructions" : "",
      globs: ["**/*"],
    };

    const fileContent = matter.stringify(this.body, frontmatter);

    return new RulesyncRule({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
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
