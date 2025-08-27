import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import { type ValidationResult } from "../types/ai-file.js";
import { type RuleFrontmatter, RuleFrontmatterSchema } from "../types/rules.js";
import { RulesyncFile, type RulesyncFileParams } from "../types/rulesync-file.js";

export interface RulesyncRuleParams extends RulesyncFileParams {
  frontmatter: RuleFrontmatter;
}

export class RulesyncRule extends RulesyncFile {
  private readonly frontmatter: RuleFrontmatter;

  constructor({ frontmatter, ...rest }: RulesyncRuleParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate !== false) {
      const result = RuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
  }

  getFrontmatter(): RuleFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RuleFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using RuleFrontmatterSchema
    const result = RuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    // Convert validated data to RuleFrontmatter type
    const validatedFrontmatter: RuleFrontmatter = {
      root: result.data.root ?? false,
      targets: result.data.targets ?? ["*"],
      description: result.data.description ?? "",
      globs: result.data.globs ?? [],
      ...(result.data.cursorRuleType && { cursorRuleType: result.data.cursorRuleType }),
      ...(result.data.windsurfActivationMode && {
        windsurfActivationMode: result.data.windsurfActivationMode,
      }),
      ...(result.data.windsurfOutputFormat && {
        windsurfOutputFormat: result.data.windsurfOutputFormat,
      }),
      ...(result.data.tags && { tags: result.data.tags }),
    };

    const filename = basename(filePath);

    return new RulesyncRule({
      baseDir: ".",
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: filename,
      frontmatter: validatedFrontmatter,
      body: content.trim(),
      fileContent,
    });
  }
}
