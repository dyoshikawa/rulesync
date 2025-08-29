import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const ClaudecodeRuleFrontmatterSchema = z.object({
  description: z.string(),
});

export type ClaudecodeRuleFrontmatter = z.infer<typeof ClaudecodeRuleFrontmatterSchema>;

export interface ClaudecodeRuleParams extends AiFileParams {
  frontmatter: ClaudecodeRuleFrontmatter;
  body: string;
}

/**
 * Rule generator for Claude Code AI assistant
 *
 * Generates CLAUDE.md memory files based on rulesync rule content.
 * Supports the Claude Code memory system with import references.
 */
export class ClaudecodeRule extends ToolRule {
  private readonly body: string;
  private readonly frontmatter: ClaudecodeRuleFrontmatter;

  constructor(params: ClaudecodeRuleParams) {
    super({
      ...params,
    });
    this.body = params.body;
    this.frontmatter = params.frontmatter;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<ClaudecodeRule> {
    const fileContent = await readFile(params.filePath, "utf8");
    const { data, content } = matter(fileContent);

    // Validate frontmatter, provide default if empty
    const frontmatter = ClaudecodeRuleFrontmatterSchema.parse(
      data.description ? data : { description: "" },
    );

    return new ClaudecodeRule({
      baseDir: params.baseDir || process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      frontmatter,
      body: content,
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    const { rulesyncRule, ...rest } = params;

    // Extract description from rulesync rule frontmatter
    const description = rulesyncRule.getFrontmatter().description;
    const root = rulesyncRule.getFrontmatter().root;

    if (root) {
      return new ClaudecodeRule({
        ...rest,
        fileContent: rulesyncRule.getFileContent(),
        relativeFilePath: "CLAUDE.md",
        frontmatter: { description },
        body: rulesyncRule.getBody(),
      });
    }

    return new ClaudecodeRule({
      ...rest,
      fileContent: rulesyncRule.getFileContent(),
      relativeDirPath: join(".claude", "memories"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter: { description },
      body: rulesyncRule.getBody(),
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["claudecode"],
      description: this.frontmatter.description,
      globs: ["**/*"],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: this.getRelativeDirPath(),
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      fileContent: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    try {
      ClaudecodeRuleFrontmatterSchema.parse(this.frontmatter);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error("Unknown validation error"),
      };
    }
  }
}
