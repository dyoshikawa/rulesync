import { basename, join } from "node:path";
import { z } from "zod/mini";
import { RULESYNC_RULES_DIR, RULESYNC_RULES_DIR_LEGACY } from "../constants/paths.js";
import { type ValidationResult } from "../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  type RulesyncFileParams,
} from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../utils/frontmatter.js";

export const RulesyncRuleFrontmatterSchema = z.object({
  root: z.optional(z.optional(z.boolean())),
  targets: z.optional(RulesyncTargetsSchema),
  description: z.optional(z.string()),
  globs: z.optional(z.array(z.string())),
  cursor: z.optional(
    z.object({
      alwaysApply: z.optional(z.boolean()),
      description: z.optional(z.string()),
      globs: z.optional(z.array(z.string())),
    }),
  ),
});

export type RulesyncRuleFrontmatter = z.infer<typeof RulesyncRuleFrontmatterSchema>;

export type RulesyncRuleParams = Omit<RulesyncFileParams, "fileContent"> & {
  frontmatter: RulesyncRuleFrontmatter;
  body: string;
};

export class RulesyncRule extends RulesyncFile {
  private readonly frontmatter: RulesyncRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncRuleParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate !== false) {
      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
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

  getFrontmatter(): RulesyncRuleFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncRuleFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  static async fromLegacyFile({
    relativeFilePath,
  }: RulesyncFileFromFileParams): Promise<RulesyncRule> {
    const filePath = join(RULESYNC_RULES_DIR_LEGACY, relativeFilePath);

    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using RuleFrontmatterSchema
    const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    const validatedFrontmatter: RulesyncRuleFrontmatter = {
      root: result.data.root ?? false,
      targets: result.data.targets ?? ["*"],
      description: result.data.description ?? "",
      globs: result.data.globs ?? [],
      cursor: result.data.cursor,
    };

    const filename = basename(filePath);

    return new RulesyncRule({
      baseDir: ".",
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: filename,
      frontmatter: validatedFrontmatter,
      body: content.trim(),
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncRule> {
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using RuleFrontmatterSchema
    const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    const validatedFrontmatter: RulesyncRuleFrontmatter = {
      root: result.data.root ?? false,
      targets: result.data.targets ?? ["*"],
      description: result.data.description ?? "",
      globs: result.data.globs ?? [],
      cursor: result.data.cursor,
    };

    const filename = basename(filePath);

    return new RulesyncRule({
      baseDir: ".",
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: filename,
      frontmatter: validatedFrontmatter,
      body: content.trim(),
    });
  }

  getBody(): string {
    return this.body;
  }
}
