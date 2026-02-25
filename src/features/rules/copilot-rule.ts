import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export const CopilotRuleFrontmatterSchema = z.object({
  description: z.optional(z.string()),
  applyTo: z.optional(z.string()),
  excludeAgent: z.optional(z.union([z.literal("code-review"), z.literal("coding-agent")])),
});

export type CopilotRuleFrontmatter = z.infer<typeof CopilotRuleFrontmatterSchema>;

export type CopilotRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: CopilotRuleFrontmatter;
  body: string;
};

export type CopilotRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export type CopilotRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

export class CopilotRule extends ToolRule {
  private readonly frontmatter: CopilotRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths(
    options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): CopilotRuleSettablePaths | CopilotRuleSettablePathsGlobal {
    if (options.global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".copilot", ".", options.excludeToolDir),
          relativeFilePath: "copilot-instructions.md",
        },
      };
    }
    return {
      root: {
        relativeDirPath: buildToolPath(".github", ".", options.excludeToolDir),
        relativeFilePath: "copilot-instructions.md",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".github", "instructions", options.excludeToolDir),
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: CopilotRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate) {
      const result = CopilotRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // If the rule is a root rule, the file content does not contain frontmatter.
      fileContent: rest.root ? body : stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  toRulesyncRule(): RulesyncRule {
    // Convert applyTo field to globs array
    let globs: string[] | undefined;
    if (this.isRoot()) {
      globs = ["**/*"];
    } else if (this.frontmatter.applyTo) {
      // Split comma-separated glob patterns
      globs = this.frontmatter.applyTo.split(",").map((g) => g.trim());
    }

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets: ["*"],
      root: this.isRoot(),
      description: this.frontmatter.description,
      globs,
      ...(this.frontmatter.excludeAgent && {
        copilot: { excludeAgent: this.frontmatter.excludeAgent },
      }),
    };

    // Strip .instructions.md extension and normalize to .md
    const originalFilePath = this.getRelativeFilePath();
    const relativeFilePath = originalFilePath.replace(/\.instructions\.md$/, ".md");

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath,
      validate: true,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): CopilotRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root;
    const paths = this.getSettablePaths({ global });

    const copilotFrontmatter: CopilotRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
      applyTo: rulesyncFrontmatter.globs?.length ? rulesyncFrontmatter.globs.join(",") : undefined,
      excludeAgent: rulesyncFrontmatter.copilot?.excludeAgent,
    };

    // Generate proper file content with Copilot specific frontmatter
    const body = rulesyncRule.getBody();

    if (root) {
      // Root file: .github/copilot-instructions.md (no frontmatter for root file)
      return new CopilotRule({
        baseDir: baseDir,
        frontmatter: copilotFrontmatter,
        body,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        validate,
        root,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${rulesyncRule.getRelativeFilePath()}`);
    }

    // Generate filename with .instructions.md extension
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}.instructions.md`;

    return new CopilotRule({
      baseDir: baseDir,
      frontmatter: copilotFrontmatter,
      body,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: newFileName,
      validate,
      root,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<CopilotRule> {
    const paths = this.getSettablePaths({ global });
    // Determine if this is a root file based on the file path
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const relativePath = join(paths.root.relativeDirPath, paths.root.relativeFilePath);
      const fileContent = await readFileContent(join(baseDir, relativePath));
      // Root file: no frontmatter expected
      return new CopilotRule({
        baseDir: baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body: fileContent.trim(),
        validate,
        root: isRoot,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    const { frontmatter, body: content } = parseFrontmatter(
      fileContent,
      join(baseDir, relativePath),
    );

    // Validate frontmatter using CopilotRuleFrontmatterSchema
    const result = CopilotRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${join(baseDir, relativeFilePath)}: ${formatError(result.error)}`,
      );
    }

    return new CopilotRule({
      baseDir: baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath.endsWith(".instructions.md")
        ? relativeFilePath
        : relativeFilePath.replace(/\.md$/, ".instructions.md"),
      frontmatter: result.data,
      body: content.trim(),
      validate,
      root: isRoot,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): CopilotRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new CopilotRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: isRoot,
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
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  getFrontmatter(): CopilotRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "copilot",
    });
  }
}
