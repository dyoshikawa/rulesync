import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";

export const RulesyncCommandFrontmatterSchema = z.object({
  targets: RulesyncTargetsSchema,
  description: z.string(),
});

export type RulesyncCommandFrontmatter = z.infer<typeof RulesyncCommandFrontmatterSchema>;

export type RulesyncCommandParams = {
  frontmatter: RulesyncCommandFrontmatter;
  body: string;
} & RulesyncFileParams;

export class RulesyncCommand extends RulesyncFile {
  private readonly frontmatter: RulesyncCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = RulesyncCommandFrontmatterSchema.safeParse(frontmatter);
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

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncCommand> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using CommandFrontmatterSchema
    const result = RulesyncCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    const filename = basename(filePath);

    return new RulesyncCommand({
      baseDir: ".",
      relativeDirPath: ".rulesync/commands",
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
    });
  }
}
