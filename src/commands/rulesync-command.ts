import { basename, join } from "node:path";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../utils/frontmatter.js";

export const RulesyncCommandFrontmatterSchema = z.object({
  targets: RulesyncTargetsSchema,
  description: z.string(),
});

export type RulesyncCommandFrontmatter = z.infer<typeof RulesyncCommandFrontmatterSchema>;

export type RulesyncCommandParams = {
  frontmatter: RulesyncCommandFrontmatter;
  body: string;
} & RulesyncFileParams;

export type RulesyncCommandSettablePaths = {
  relativeDirPath: string;
};

export class RulesyncCommand extends RulesyncFile {
  private readonly frontmatter: RulesyncCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncCommandParams) {
    if (rest.validate) {
      const result = RulesyncCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.baseDir ?? ".", rest.relativeDirPath, rest.relativeFilePath)}: ${result.error.message}`,
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

  static getSettablePaths(): RulesyncCommandSettablePaths {
    return {
      relativeDirPath: ".rulesync/commands",
    };
  }

  getFrontmatter(): RulesyncCommandFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
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
      return { success: false, error: result.error };
    }
  }

  static async fromFile({
    relativeFilePath,
  }: RulesyncFileFromFileParams): Promise<RulesyncCommand> {
    // Read file content
    const fileContent = await readFileContent(
      join(RulesyncCommand.getSettablePaths().relativeDirPath, relativeFilePath),
    );
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using CommandFrontmatterSchema
    const result = RulesyncCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${relativeFilePath}: ${result.error.message}`);
    }

    const filename = basename(relativeFilePath);

    return new RulesyncCommand({
      baseDir: ".",
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
    });
  }
}
