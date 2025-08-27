import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";

export const RulesyncIgnoreFrontmatterSchema = z.object({
  targets: RulesyncTargetsSchema,
  description: z.string(),
  patterns: z.optional(z.array(z.string())),
});

export type RulesyncIgnoreFrontmatter = z.infer<typeof RulesyncIgnoreFrontmatterSchema>;

export interface RulesyncIgnoreParams extends RulesyncFileParams {
  frontmatter: RulesyncIgnoreFrontmatter;
}

export class RulesyncIgnore extends RulesyncFile {
  private readonly frontmatter: RulesyncIgnoreFrontmatter;

  constructor({ frontmatter, ...rest }: RulesyncIgnoreParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate !== false) {
      const result = RulesyncIgnoreFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
  }

  getFrontmatter(): RulesyncIgnoreFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncIgnoreFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncIgnore> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using IgnoreFrontmatterSchema
    const result = RulesyncIgnoreFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    const filename = basename(filePath);

    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
    });
  }
}
