import { basename, join } from "node:path";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { RulesyncTargets } from "../types/tool-targets.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromFileParams, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

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

export class CursorRule extends ToolRule {
  private readonly frontmatter: CursorRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CursorRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate) {
      const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
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
    // If there are no globs or they don't contain asterisk patterns, use the default stringifier
    if (
      !frontmatter.globs ||
      typeof frontmatter.globs !== "string" ||
      !frontmatter.globs.includes("*")
    ) {
      return stringifyFrontmatter(body, frontmatter);
    }

    // For globs with asterisk patterns, manually build the YAML frontmatter
    // to ensure they are output without quotes
    const lines: string[] = ["---"];

    if (frontmatter.alwaysApply !== undefined) {
      lines.push(`alwaysApply: ${frontmatter.alwaysApply}`);
    }
    if (frontmatter.description !== undefined) {
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
  private static parseCursorFrontmatter(fileContent: string): {
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

    return parseFrontmatter(preprocessedContent);
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
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: this.relativeFilePath.replace(/\.mdc$/, ".md"),
      validate: true,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): CursorRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    const cursorFrontmatter: CursorRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
      globs:
        (rulesyncFrontmatter.globs?.length ?? 0 > 0)
          ? rulesyncFrontmatter.globs?.join(",")
          : undefined,
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
      relativeDirPath: ".cursor/rules",
      relativeFilePath: newFileName,
      validate,
    });
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<CursorRule> {
    // Read file content
    const fileContent = await readFileContent(join(baseDir, ".cursor/rules", relativeFilePath));

    // Use custom parser for MDC files
    const { frontmatter, body: content } = CursorRule.parseCursorFrontmatter(fileContent);

    // Validate frontmatter using CursorRuleFrontmatterSchema
    const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${join(baseDir, relativeFilePath)}: ${result.error.message}`,
      );
    }

    return new CursorRule({
      baseDir,
      relativeDirPath: ".cursor/rules",
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
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
      return { success: false, error: result.error };
    }
  }

  getFrontmatter(): CursorRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }
}
