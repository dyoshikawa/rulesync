import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { optional, z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import { ToolCommand, ToolCommandFromRulesyncCommandParams } from "./tool-command.js";

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
    if (rest.validate !== false) {
      const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
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
    const fileContent = matter.stringify(this.body, rulesyncFrontmatter);

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
    relativeDirPath,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): RooCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const rooFrontmatter: RooCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    // Generate proper file content with Roo Code specific frontmatter
    const body = rulesyncCommand.getBody();
    // Remove undefined values to avoid YAML dump errors
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(rooFrontmatter).filter(([, value]) => value !== undefined),
    );
    const fileContent = matter.stringify(body, cleanFrontmatter);

    return new RooCommand({
      baseDir: baseDir,
      frontmatter: rooFrontmatter,
      body,
      relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      fileContent,
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

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<RooCommand> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using RooCommandFrontmatterSchema
    const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new RooCommand({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }
}
