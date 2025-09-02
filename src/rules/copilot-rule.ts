import matter from "gray-matter";
import { z } from "zod/mini";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export const CopilotRuleFrontmatterSchema = z.object({
  description: z.optional(z.string()),
  applyTo: z.optional(z.string()),
});

export type CopilotRuleFrontmatter = z.infer<typeof CopilotRuleFrontmatterSchema>;

export type CopilotRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: CopilotRuleFrontmatter;
  body: string;
};

export class CopilotRule extends ToolRule {
  private readonly frontmatter: CopilotRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CopilotRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate) {
      const result = CopilotRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter),
    });

    // Set default value for applyTo if not provided
    this.frontmatter = frontmatter;
    this.body = body;
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets: ["*"],
      root: this.isRoot(),
      description: this.frontmatter.description,
      globs: this.isRoot() ? ["**/*"] : [],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): CopilotRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root;

    const copilotFrontmatter: CopilotRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
      applyTo: rulesyncFrontmatter.globs?.join(","),
    };

    // Generate proper file content with Copilot specific frontmatter
    const body = rulesyncRule.getBody();

    if (root) {
      // Root file: .github/copilot-instructions.md (no frontmatter for root file)
      return new CopilotRule({
        baseDir: baseDir,
        frontmatter: copilotFrontmatter,
        body,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        validate,
        root,
      });
    }

    // Generate filename with .instructions.md extension
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}.instructions.md`;

    return new CopilotRule({
      baseDir: baseDir,
      frontmatter: copilotFrontmatter,
      body,
      relativeDirPath: ".github/instructions",
      relativeFilePath: newFileName,
      validate,
      root,
    });
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<CopilotRule> {
    // Read file content
    const fileContent = await readFileContent(filePath);

    // Determine if this is a root file based on the file path
    const root = relativeFilePath === "copilot-instructions.md";

    if (root) {
      // Root file: no frontmatter expected
      return new CopilotRule({
        baseDir: baseDir,
        relativeDirPath: relativeDirPath,
        relativeFilePath: relativeFilePath,
        frontmatter: {
          description: "",
          applyTo: "**",
        },
        body: fileContent.trim(),
        validate,
        root,
      });
    }

    // Non-root file: parse frontmatter
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using CopilotRuleFrontmatterSchema
    const result = CopilotRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new CopilotRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: {
        ...result.data,
        applyTo: result.data.applyTo || "**",
      },
      body: content.trim(),
      validate,
      root,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CopilotRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  getFrontmatter(): CopilotRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }
}
