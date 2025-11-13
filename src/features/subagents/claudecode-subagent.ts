import { join } from "node:path";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
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
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".claude", "agents"),
    };
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

    return new RulesyncSubagent({
      baseDir: ".", // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: join(".rulesync", "subagents"),
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
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

    const paths = this.getSettablePaths({ global });

    return new ClaudecodeSubagent({
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
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
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "claudecode",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<ClaudecodeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using ClaudecodeSubagentFrontmatterSchema
    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ClaudecodeSubagent({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }
}
