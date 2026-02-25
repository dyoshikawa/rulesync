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
export const CursorCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  handoffs: z.optional(
    z.array(
      z.looseObject({
        label: z.string(),
        agent: z.optional(z.string()),
        prompt: z.optional(z.string()),
        send: z.optional(z.boolean()),
      }),
    ),
  ),
});

export type CursorCommandFrontmatter = z.infer<typeof CursorCommandFrontmatterSchema>;

export type CursorCommandParams = {
  frontmatter: CursorCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class CursorCommand extends ToolCommand {
  private readonly frontmatter: CursorCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CursorCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = CursorCommandFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".cursor", "commands"),
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description = "", ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      // Preserve extra fields in cursor section
      ...(Object.keys(restFields).length > 0 && { cursor: restFields }),
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
    global = false,
  }: ToolCommandFromRulesyncCommandParams): CursorCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge cursor-specific fields from rulesync frontmatter
    const cursorFields = rulesyncFrontmatter.cursor ?? {};

    const cursorFrontmatter: CursorCommandFrontmatter = {
      ...(rulesyncFrontmatter.description && { description: rulesyncFrontmatter.description }),
      ...cursorFields,
    };

    // Generate proper file content with Cursor specific frontmatter
    const body = rulesyncCommand.getBody();

    const paths = this.getSettablePaths({ global });

    return new CursorCommand({
      baseDir: baseDir,
      frontmatter: cursorFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CursorCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "cursor",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<CursorCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate using CursorCommandFrontmatterSchema (soft — allows unknown fields)
    const result = CursorCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new CursorCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): CursorCommand {
    return new CursorCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
    });
  }
}
