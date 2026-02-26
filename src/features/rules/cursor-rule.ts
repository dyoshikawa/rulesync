import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export const CursorRuleFrontmatterSchema = z.object({
  description: z.optional(z.string()),
  globs: z.optional(z.string()),
  alwaysApply: z.optional(z.boolean()),
});

export type CursorRuleFrontmatter = z.infer<typeof CursorRuleFrontmatterSchema>;

export type CursorRuleParams = {
  frontmatter: CursorRuleFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export type CursorRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

export class CursorRule extends ToolRule {
  private readonly frontmatter: CursorRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): CursorRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".cursor", "rules", _options.excludeToolDir),
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: CursorRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate) {
      const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: CursorRule.stringifyCursorFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  /**
   * Custom stringify function for Cursor MDC files
   * MDC files don't support quotes in YAML, so globs patterns must be output without quotes
   */
  private static stringifyCursorFrontmatter(
    body: string,
    frontmatter: CursorRuleFrontmatter,
  ): string {
    // For cursor settings, manually build the YAML frontmatter
    // to ensure they are output without quotes
    const lines: string[] = ["---"];

    if (frontmatter.alwaysApply !== undefined) {
      lines.push(`alwaysApply: ${frontmatter.alwaysApply}`);
    }
    if (frontmatter.description) {
      lines.push(`description: ${frontmatter.description}`);
    }
    if (frontmatter.globs !== undefined) {
      // Output globs without quotes
      lines.push(`globs: ${frontmatter.globs}`);
    }

    lines.push("---");
    lines.push("");

    if (body) {
      lines.push(body);
    }

    return lines.join("\n");
  }

  /**
   * Custom parse function for Cursor MDC files
   * MDC files don't support quotes in YAML, so we need to handle patterns like *.ts specially
   */
  private static parseCursorFrontmatter(
    fileContent: string,
    filePath?: string,
  ): {
    frontmatter: Record<string, unknown>;
    body: string;
  } {
    // Special handling for MDC files: preprocess globs field to handle asterisks
    // MDC files don't support quotes in YAML, so we need to handle patterns like *.ts specially
    const preprocessedContent = fileContent.replace(
      /^globs:\s*(\*[^\n]*?)$/m,
      (_match, globPattern) => {
        // Wrap the glob pattern in quotes for YAML parsing
        return `globs: "${globPattern}"`;
      },
    );

    return parseFrontmatter(preprocessedContent, filePath);
  }

  toRulesyncRule(): RulesyncRule {
    const targets: RulesyncTargets = ["*"];

    // Convert Cursor rule types to Rulesync format
    const isAlways = this.frontmatter.alwaysApply === true;
    const hasGlobs = this.frontmatter.globs && this.frontmatter.globs.trim() !== "";

    // Determine globs array
    let globs: string[];
    if (hasGlobs && this.frontmatter.globs) {
      // Split globs string by comma and trim whitespace
      globs = this.frontmatter.globs
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0);
    } else if (isAlways) {
      globs = ["**/*"];
    } else {
      globs = [];
    }

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs,
      cursor: {
        alwaysApply: this.frontmatter.alwaysApply,
        description: this.frontmatter.description,
        globs: globs.length > 0 ? globs : undefined,
      },
    };

    return new RulesyncRule({
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.relativeFilePath.replace(/\.mdc$/, ".md"),
      validate: true,
    });
  }

  /**
   * Resolve cursor globs with priority: cursor-specific > parent
   * Returns comma-separated string for Cursor format, or undefined if no globs
   * @param cursorSpecificGlobs - Cursor-specific globs (takes priority if defined)
   * @param parentGlobs - Parent globs (used if cursorSpecificGlobs is undefined)
   */
  private static resolveCursorGlobs(
    cursorSpecificGlobs: string[] | undefined,
    parentGlobs: string[] | undefined,
  ): string | undefined {
    const targetGlobs = cursorSpecificGlobs !== undefined ? cursorSpecificGlobs : parentGlobs;
    return targetGlobs && targetGlobs.length > 0 ? targetGlobs.join(",") : undefined;
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): CursorRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    const cursorFrontmatter: CursorRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
      globs: this.resolveCursorGlobs(rulesyncFrontmatter.cursor?.globs, rulesyncFrontmatter.globs),
      alwaysApply: rulesyncFrontmatter.cursor?.alwaysApply ?? undefined,
    };

    // Generate proper file content with Cursor specific frontmatter
    const body = rulesyncRule.getBody();

    // Generate filename with .mdc extension
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}.mdc`;

    return new CursorRule({
      baseDir: baseDir,
      frontmatter: cursorFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: newFileName,
      validate,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<CursorRule> {
    // Read file content
    const filePath = join(
      baseDir,
      this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);

    // Use custom parser for MDC files
    const { frontmatter, body: content } = CursorRule.parseCursorFrontmatter(fileContent, filePath);

    // Validate frontmatter using CursorRuleFrontmatterSchema
    const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${join(baseDir, relativeFilePath)}: ${formatError(result.error)}`,
      );
    }

    return new CursorRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): CursorRule {
    return new CursorRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CursorRuleFrontmatterSchema.safeParse(this.frontmatter);
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

  getFrontmatter(): CursorRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "cursor",
    });
  }
}
