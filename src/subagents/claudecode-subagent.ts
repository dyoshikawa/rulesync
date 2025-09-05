import { join } from "node:path";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
} from "./tool-subagent.js";

export const ClaudecodeSubagentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  model: z.optional(z.enum(["opus", "sonnet", "haiku", "inherit"])),
});

export type ClaudecodeSubagentFrontmatter = z.infer<typeof ClaudecodeSubagentFrontmatterSchema>;

export type ClaudecodeSubagentParams = {
  frontmatter: ClaudecodeSubagentFrontmatter;
  body: string;
} & AiFileParams;

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

  getFrontmatter(): ClaudecodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["claudecode"] as const,
      name: this.frontmatter.name,
      description: this.frontmatter.description,
      ...(this.frontmatter.model && {
        claudecode: {
          model: this.frontmatter.model,
        },
      }),
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncSubagent({
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/subagents",
      relativeFilePath: this.getRelativeFilePath(),
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    baseDir = ".",
    rulesyncSubagent,
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
    const fileContent = stringifyFrontmatter(body, claudecodeFrontmatter);

    return new ClaudecodeSubagent({
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: ".claude/agents",
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

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolSubagentFromFileParams): Promise<ClaudecodeSubagent> {
    // Read file content
    const fileContent = await readFileContent(join(baseDir, ".claude/agents", relativeFilePath));
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using ClaudecodeSubagentFrontmatterSchema
    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${relativeFilePath}: ${result.error.message}`);
    }

    return new ClaudecodeSubagent({
      baseDir: baseDir,
      relativeDirPath: ".claude/agents",
      relativeFilePath: relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }
}
