import { join } from "node:path";

import { z } from "zod/mini";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const CopilotCommandFrontmatterSchema = z.looseObject({
  mode: z.optional(z.string()),
  description: z.string(),
});

export type CopilotCommandFrontmatter = z.infer<typeof CopilotCommandFrontmatterSchema>;

export type CopilotCommandParams = {
  frontmatter: CopilotCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class CopilotCommand extends ToolCommand {
  private readonly frontmatter: CopilotCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CopilotCommandParams) {
    if (rest.validate) {
      const result = CopilotCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".github", "prompts"),
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): CopilotCommandFrontmatter {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { mode: _mode, description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      // Preserve extra fields in copilot section (excluding mode which is fixed)
      ...(Object.keys(restFields).length > 0 && { copilot: restFields }),
    };

    // Strip .prompt.md extension and normalize to .md
    const originalFilePath = this.relativeFilePath;
    const relativeFilePath = originalFilePath.replace(/\.prompt\.md$/, ".md");

    return new RulesyncCommand({
      baseDir: this.baseDir,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CopilotCommandFrontmatterSchema.safeParse(this.frontmatter);
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

  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): CopilotCommand {
    const paths = this.getSettablePaths();
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge copilot-specific fields from rulesync frontmatter
    const copilotFields = rulesyncFrontmatter.copilot ?? {};

    const copilotFrontmatter: CopilotCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...copilotFields,
    };

    const body = rulesyncCommand.getBody();

    // Change file extension from .md to .prompt.md
    const originalFilePath = rulesyncCommand.getRelativeFilePath();
    const relativeFilePath = originalFilePath.replace(/\.md$/, ".prompt.md");

    return new CopilotCommand({
      baseDir: baseDir,
      frontmatter: copilotFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<CopilotCommand> {
    const paths = this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = CopilotCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new CopilotCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "copilot",
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): CopilotCommand {
    return new CopilotCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
