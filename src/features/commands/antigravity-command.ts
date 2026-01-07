import { basename, join } from "node:path";
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
} from "./tool-command.js";

export const AntigravityCommandFrontmatterSchema = z.object({
  description: z.string(),
});

export type AntigravityCommandFrontmatter = z.infer<typeof AntigravityCommandFrontmatterSchema>;

export type AntigravityCommandParams = {
  frontmatter: AntigravityCommandFrontmatter;
  body: string;
} & AiFileParams;

export type AntigravityCommandSettablePaths = {
  relativeDirPath: string;
};

/**
 * Command generator for Google Antigravity IDE
 *
 * Generates workflow files for Antigravity's .agent/workflows/ directory.
 */
export class AntigravityCommand extends ToolCommand {
  private readonly frontmatter: AntigravityCommandFrontmatter;
  private readonly body: string;

  static getSettablePaths(): AntigravityCommandSettablePaths {
    return {
      relativeDirPath: join(".agent", "workflows"),
    };
  }

  constructor({ frontmatter, body, ...rest }: AntigravityCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = AntigravityCommandFrontmatterSchema.safeParse(frontmatter);
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

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["antigravity"],
      description: this.frontmatter.description,
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: ".", // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): AntigravityCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const antigravityFrontmatter: AntigravityCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    // Generate proper file content with Antigravity specific frontmatter
    const body = rulesyncCommand.getBody();
    const fileContent = stringifyFrontmatter(body, antigravityFrontmatter);

    return new AntigravityCommand({
      baseDir: baseDir,
      frontmatter: antigravityFrontmatter,
      body,
      relativeDirPath: AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      fileContent: fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = AntigravityCommandFrontmatterSchema.safeParse(this.frontmatter);
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

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "antigravity",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<AntigravityCommand> {
    const filePath = join(
      baseDir,
      AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using AntigravityCommandFrontmatterSchema
    const result = AntigravityCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new AntigravityCommand({
      baseDir: baseDir,
      relativeDirPath: AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): AntigravityCommand {
    return new AntigravityCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
