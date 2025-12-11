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
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";

/**
 * Claude Code rule frontmatter schema
 * Supports the `paths` field for conditional rule application based on file patterns
 * @see https://code.claude.com/docs/en/memory#modular-rules-with-claude/rules/
 */
export const ClaudecodeRuleFrontmatterSchema = z.object({
  // Glob pattern for conditional rule application
  // @example "src/api/**/*.ts"
  paths: z.optional(z.string()),
});

export type ClaudecodeRuleFrontmatter = z.infer<typeof ClaudecodeRuleFrontmatterSchema>;

export type ClaudecodeRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: ClaudecodeRuleFrontmatter;
  body: string;
};

export type ClaudecodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export type ClaudecodeRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for Claude Code AI assistant
 *
 * Generates .claude/CLAUDE.md and .claude/rules/*.md files based on rulesync rule content.
 * Supports the Claude Code modular rules system with frontmatter for path-specific rules.
 *
 * @see https://code.claude.com/docs/en/memory#modular-rules-with-claude/rules/
 */
export class ClaudecodeRule extends ToolRule {
  private readonly frontmatter: ClaudecodeRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths({
    global,
  }: {
    global?: boolean;
  } = {}): ClaudecodeRuleSettablePaths | ClaudecodeRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: ".claude",
          relativeFilePath: "CLAUDE.md",
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".claude",
        relativeFilePath: "CLAUDE.md",
      },
      nonRoot: {
        relativeDirPath: join(".claude", "rules"),
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: ClaudecodeRuleParams) {
    // Validate frontmatter before calling super
    if (rest.validate !== false) {
      const result = ClaudecodeRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // Root file: no frontmatter, just body
      // Non-root file: frontmatter with paths field + body
      fileContent: rest.root ? body : stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<ClaudecodeRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const relativePath = join(paths.root.relativeDirPath, paths.root.relativeFilePath);
      const fileContent = await readFileContent(join(baseDir, relativePath));

      // Root file: no frontmatter expected
      return new ClaudecodeRule({
        baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body: fileContent.trim(),
        validate,
        root: true,
      });
    }

    if (!paths.nonRoot) {
      throw new Error("nonRoot path is not set");
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    // Non-root file: parse frontmatter
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using ClaudecodeRuleFrontmatterSchema
    const result = ClaudecodeRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${join(baseDir, relativePath)}: ${formatError(result.error)}`,
      );
    }

    return new ClaudecodeRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    const paths = this.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root ?? false;

    // Convert globs to paths field for Claude Code
    // Priority: claudecode.paths > globs (joined with comma)
    const pathsField =
      rulesyncFrontmatter.claudecode?.paths ?? rulesyncFrontmatter.globs?.join(", ");

    const claudecodeFrontmatter: ClaudecodeRuleFrontmatter = {
      paths: pathsField,
    };

    const body = rulesyncRule.getBody();

    if (root) {
      // Root file: .claude/CLAUDE.md (no frontmatter for root file)
      return new ClaudecodeRule({
        baseDir: baseDir,
        frontmatter: claudecodeFrontmatter,
        body,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        validate,
        root,
      });
    }

    if (!paths.nonRoot) {
      throw new Error("nonRoot path is not set in non-global mode");
    }

    // Non-root file: .claude/rules/*.md
    return new ClaudecodeRule({
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      validate,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    // Convert paths field back to globs array
    let globs: string[] | undefined;
    if (this.isRoot()) {
      globs = ["**/*"];
    } else if (this.frontmatter.paths) {
      // Split comma-separated glob patterns
      globs = this.frontmatter.paths.split(",").map((g) => g.trim());
    }

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets: ["*"],
      root: this.isRoot(),
      description: this.description,
      globs,
      ...(this.frontmatter.paths && {
        claudecode: { paths: this.frontmatter.paths },
      }),
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.isRoot() ? "overview.md" : this.getRelativeFilePath(),
      validate: true,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ClaudecodeRuleFrontmatterSchema.safeParse(this.frontmatter);
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

  getFrontmatter(): ClaudecodeRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "claudecode",
    });
  }
}
