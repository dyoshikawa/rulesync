import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema, ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
// Tool-specific sections (e.g., claudecode:, copilot:) are preserved as additional keys
export const RulesyncCommandFrontmatterSchema = z.looseObject({
  targets: z._default(RulesyncTargetsSchema, ["*"]),
  description: z.string(),
});

// Input type allows targets to be omitted (will use default value)
export type RulesyncCommandFrontmatterInput = z.input<typeof RulesyncCommandFrontmatterSchema> &
  Partial<Record<ToolTarget, Record<string, unknown>>>;
// Output type has targets always present after parsing
export type RulesyncCommandFrontmatter = z.infer<typeof RulesyncCommandFrontmatterSchema> &
  Partial<Record<ToolTarget, Record<string, unknown>>>;

export type RulesyncCommandParams = {
  frontmatter: RulesyncCommandFrontmatterInput;
  body: string;
} & RulesyncFileParams;

export type RulesyncCommandSettablePaths = {
  relativeDirPath: string;
};

export class RulesyncCommand extends RulesyncFile {
  private readonly frontmatter: RulesyncCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncCommandParams) {
    // Parse frontmatter to apply defaults and validate
    const parseResult = RulesyncCommandFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate) {
      throw new Error(
        `Invalid frontmatter in ${join(rest.baseDir ?? process.cwd(), rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`,
      );
    }
    // Apply defaults manually when validation is disabled but parsing failed
    // Merge with frontmatter to preserve tool-specific sections (looseObject passthrough)
    const parsedFrontmatter: RulesyncCommandFrontmatter = parseResult.success
      ? { ...frontmatter, ...parseResult.data }
      : { ...frontmatter, targets: frontmatter.targets ?? ["*"] };

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter),
    });

    this.frontmatter = parsedFrontmatter;
    this.body = body;
  }

  static getSettablePaths(): RulesyncCommandSettablePaths {
    return {
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
    };
  }

  getFrontmatter(): RulesyncCommandFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  withRelativeFilePath(newRelativeFilePath: string): RulesyncCommand {
    return new RulesyncCommand({
      baseDir: this.getBaseDir(),
      relativeDirPath: this.getRelativeDirPath(),
      relativeFilePath: newRelativeFilePath,
      frontmatter: this.getFrontmatter(),
      body: this.getBody(),
      fileContent: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncCommandFrontmatterSchema.safeParse(this.frontmatter);

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

  static async fromFile({
    relativeFilePath,
  }: RulesyncFileFromFileParams): Promise<RulesyncCommand> {
    // Read file content
    const filePath = join(
      process.cwd(),
      RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate frontmatter using CommandFrontmatterSchema
    const result = RulesyncCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${relativeFilePath}: ${formatError(result.error)}`);
    }

    return new RulesyncCommand({
      baseDir: process.cwd(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
    });
  }
}
