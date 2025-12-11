import { basename, join } from "node:path";
import { z } from "zod/mini";
import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { type ValidationResult } from "../../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  type RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { logger } from "../../utils/logger.js";

export const RulesyncRuleFrontmatterSchema = z.object({
  root: z.optional(z.optional(z.boolean())),
  targets: z.optional(RulesyncTargetsSchema),
  description: z.optional(z.string()),
  globs: z.optional(z.array(z.string())),
  agentsmd: z.optional(
    z.object({
      // @example "path/to/subproject"
      subprojectPath: z.optional(z.string()),
    }),
  ),
  cursor: z.optional(
    z.object({
      alwaysApply: z.optional(z.boolean()),
      description: z.optional(z.string()),
      globs: z.optional(z.array(z.string())),
    }),
  ),
  copilot: z.optional(
    z.object({
      excludeAgent: z.optional(z.union([z.literal("code-review"), z.literal("coding-agent")])),
    }),
  ),
  claudecode: z.optional(
    z.object({
      // Override globs with Claude Code specific paths field
      // @example "src/**/*.ts"
      paths: z.optional(z.string()),
    }),
  ),
});

export type RulesyncRuleFrontmatter = z.infer<typeof RulesyncRuleFrontmatterSchema>;

export type RulesyncRuleParams = Omit<RulesyncFileParams, "fileContent"> & {
  frontmatter: RulesyncRuleFrontmatter;
  body: string;
};

export type RulesyncRuleSettablePaths = {
  recommended: {
    relativeDirPath: string;
  };
  legacy: {
    relativeDirPath: string;
  };
};

export class RulesyncRule extends RulesyncFile {
  private readonly frontmatter: RulesyncRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: RulesyncRuleParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate !== false) {
      const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths(): RulesyncRuleSettablePaths {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      },
    };
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
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static async fromFileLegacy({
    relativeFilePath,
    validate = true,
  }: RulesyncFileFromFileParams): Promise<RulesyncRule> {
    const legacyPath = join(
      process.cwd(),
      this.getSettablePaths().legacy.relativeDirPath,
      relativeFilePath,
    );
    const recommendedPath = join(
      this.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath,
    );

    logger.warn(`⚠️  Using deprecated path "${legacyPath}". Please migrate to "${recommendedPath}"`);

    // Read file content
    const fileContent = await readFileContent(legacyPath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using RuleFrontmatterSchema
    const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${legacyPath}: ${formatError(result.error)}`);
    }

    const validatedFrontmatter: RulesyncRuleFrontmatter = {
      root: result.data.root ?? false,
      targets: result.data.targets ?? ["*"],
      description: result.data.description ?? "",
      globs: result.data.globs ?? [],
      agentsmd: result.data.agentsmd,
      cursor: result.data.cursor,
      claudecode: result.data.claudecode,
    };

    const filename = basename(legacyPath);

    return new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: this.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: filename,
      frontmatter: validatedFrontmatter,
      body: content.trim(),
      validate,
    });
  }

  static async fromFile({
    relativeFilePath,
    validate = true,
  }: RulesyncFileFromFileParams): Promise<RulesyncRule> {
    const filePath = join(
      process.cwd(),
      this.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath,
    );

    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using RuleFrontmatterSchema
    const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    const validatedFrontmatter: RulesyncRuleFrontmatter = {
      root: result.data.root ?? false,
      targets: result.data.targets ?? ["*"],
      description: result.data.description ?? "",
      globs: result.data.globs ?? [],
      agentsmd: result.data.agentsmd,
      cursor: result.data.cursor,
      claudecode: result.data.claudecode,
    };

    const filename = basename(filePath);

    return new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: this.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: filename,
      frontmatter: validatedFrontmatter,
      body: content.trim(),
      validate,
    });
  }

  getBody(): string {
    return this.body;
  }
}
