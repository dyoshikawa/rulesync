import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { ToolSubagent, ToolSubagentFromRulesyncSubagentParams } from "./tool-subagent.js";

export const ClaudecodeSubagentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
});

export type ClaudecodeSubagentFrontmatter = z.infer<typeof ClaudecodeSubagentFrontmatterSchema>;

export interface ClaudecodeSubagentParams extends AiFileParams {
  frontmatter: ClaudecodeSubagentFrontmatter;
  body: string;
}

export class ClaudecodeSubagent extends ToolSubagent {
  private readonly frontmatter: ClaudecodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ClaudecodeSubagentParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = ClaudecodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    return new RulesyncSubagent({
      frontmatter: {
        targets: ["claudecode"],
        name: this.frontmatter.name,
        description: this.frontmatter.description,
      },
      body: this.body,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.fileContent,
      validate: false,
    });
  }

  static fromRulesyncSubagent({
    baseDir = ".",
    rulesyncSubagent,
    relativeDirPath,
    validate = true,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const claudecodeFrontmatter: ClaudecodeSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      model: rulesyncFrontmatter.claudecode?.model,
    };

    // Generate proper file content with Claude Code specific frontmatter
    const body = rulesyncSubagent.getBody();
    // Remove undefined values to avoid YAML dump errors
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(claudecodeFrontmatter).filter(([, value]) => value !== undefined)
    );
    const fileContent = matter.stringify(body, cleanFrontmatter);

    return new ClaudecodeSubagent({
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }
}
