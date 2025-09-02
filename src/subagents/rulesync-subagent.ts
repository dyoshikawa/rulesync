import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";

export const RulesyncSubagentModelSchema = z.enum(["opus", "sonnet", "haiku", "inherit"]);

export const RulesyncSubagentFrontmatterSchema = z.object({
  targets: RulesyncTargetsSchema,
  name: z.string(),
  description: z.string(),
  claudecode: z.optional(
    z.object({
      model: RulesyncSubagentModelSchema,
    }),
  ),
});

export type RulesyncSubagentFrontmatter = z.infer<typeof RulesyncSubagentFrontmatterSchema>;

export type RulesyncSubagentParams = {
  frontmatter: RulesyncSubagentFrontmatter;
  body: string;
} & RulesyncFileParams;

export class RulesyncSubagent extends RulesyncFile {
  private readonly frontmatter: RulesyncSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncSubagentParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate !== false) {
      const result = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
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

  getFrontmatter(): RulesyncSubagentFrontmatter {
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

    const result = RulesyncSubagentFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncSubagent> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using SubagentFrontmatterSchema
    const result = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    const filename = basename(filePath);

    return new RulesyncSubagent({
      baseDir: ".",
      relativeDirPath: ".rulesync/subagents",
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
    });
  }
}
