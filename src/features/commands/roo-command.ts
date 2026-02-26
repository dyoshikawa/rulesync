import { join } from "node:path";

import { optional, z } from "zod/mini";

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

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const RooCommandFrontmatterSchema = z.looseObject({
  description: z.string(),
  "argument-hint": optional(z.string()),
});

export type RooCommandFrontmatter = z.infer<typeof RooCommandFrontmatterSchema>;

export type RooCommandParams = {
  frontmatter: RooCommandFrontmatter;
  body: string;
} & AiFileParams;

export type RooCommandSettablePaths = {
  relativeDirPath: string;
};

export class RooCommand extends ToolCommand {
  private readonly frontmatter: RooCommandFrontmatter;
  private readonly body: string;

  static getSettablePaths(): RooCommandSettablePaths {
    return {
      relativeDirPath: join(".roo", "commands"),
    };
  }

  constructor({ frontmatter, body, ...rest }: RooCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
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
    const { description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["roo"],
      description,
      // Preserve extra fields in roo section
      ...(Object.keys(restFields).length > 0 && { roo: restFields }),
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
  }: ToolCommandFromRulesyncCommandParams): RooCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge roo-specific fields from rulesync frontmatter
    const rooFields = rulesyncFrontmatter.roo ?? {};

    const rooFrontmatter: RooCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...rooFields,
    };

    // Generate proper file content with Roo Code specific frontmatter
    const body = rulesyncCommand.getBody();
    const fileContent = stringifyFrontmatter(body, rooFrontmatter);

    return new RooCommand({
      baseDir: baseDir,
      frontmatter: rooFrontmatter,
      body,
      relativeDirPath: RooCommand.getSettablePaths().relativeDirPath,
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

    const result = RooCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "roo",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<RooCommand> {
    const filePath = join(baseDir, RooCommand.getSettablePaths().relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate frontmatter using RooCommandFrontmatterSchema
    const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new RooCommand({
      baseDir: baseDir,
      relativeDirPath: RooCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
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
  }: ToolCommandForDeletionParams): RooCommand {
    return new RooCommand({
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
