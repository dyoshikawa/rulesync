import { basename, join } from "node:path";
import { optional, z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

export const RooCommandFrontmatterSchema = z.object({
  description: z.string(),
  "argument-hint": optional(z.string()),
});

export type RooCommandFrontmatter = z.infer<typeof RooCommandFrontmatterSchema>;

export type RooCommandParams = {
  frontmatter: RooCommandFrontmatter;
  body: string;
} & AiFileParams;

export class RooCommand extends ToolCommand {
  private readonly frontmatter: RooCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RooCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
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
      targets: ["roo"],
      description: this.frontmatter.description,
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: this.baseDir,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: ".rulesync/commands",
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): RooCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const rooFrontmatter: RooCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    // Generate proper file content with Roo Code specific frontmatter
    const body = rulesyncCommand.getBody();
    const fileContent = stringifyFrontmatter(body, rooFrontmatter);

    return new RooCommand({
      baseDir: baseDir,
      frontmatter: rooFrontmatter,
      body,
      relativeDirPath: ".roo/commands",
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
      return { success: false, error: result.error };
    }
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<RooCommand> {
    const filePath = join(baseDir, ".roo", "commands", relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using RooCommandFrontmatterSchema
    const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new RooCommand({
      baseDir: baseDir,
      relativeDirPath: ".roo/commands",
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }
}
