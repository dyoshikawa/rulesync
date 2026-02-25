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

/**
 * Frontmatter schema for Claude Code modular rules
 * @see https://code.claude.com/docs/en/memory#modular-rules-with-clauderules
 */
export const ClaudecodeRuleFrontmatterSchema = z.object({
  paths: z.optional(z.array(z.string())),
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
 * Rule generator for Claude Code AI assistant (Modular Rules)
 *
 * Generates modular rule files based on rulesync rule content.
 * Supports the Claude Code modular rules system.
 *
 * Modular rules format:
 * - {project}/CLAUDE.md (root: true)
 * - {project}/.claude/rules/*.md (root: false, with optional `paths` frontmatter)
 *
 * @see https://code.claude.com/docs/en/memory#modular-rules-with-clauderules
 */
export class ClaudecodeRule extends ToolRule {
  private readonly frontmatter: ClaudecodeRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ClaudecodeRuleSettablePaths | ClaudecodeRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".claude", ".", excludeToolDir),
          relativeFilePath: "CLAUDE.md",
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".claude", "rules", excludeToolDir),
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: ClaudecodeRuleParams) {
    // Validate frontmatter before calling super
    if (rest.validate) {
      const result = ClaudecodeRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // Root file: no frontmatter; Non-root file: with optional paths frontmatter
      fileContent: rest.root ? body : ClaudecodeRule.generateFileContent(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  private static generateFileContent(body: string, frontmatter: ClaudecodeRuleFrontmatter): string {
    // Only include frontmatter if paths is defined
    if (frontmatter.paths) {
      return stringifyFrontmatter(body, { paths: frontmatter.paths });
    }
    return body;
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
      const fileContent = await readFileContent(
        join(baseDir, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );

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
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));
    const { frontmatter, body: content } = parseFrontmatter(
      fileContent,
      join(baseDir, relativePath),
    );

    // Validate frontmatter
    const result = ClaudecodeRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${join(baseDir, relativePath)}: ${formatError(result.error)}`,
      );
    }

    return new ClaudecodeRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
      root: false,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): ClaudecodeRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new ClaudecodeRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root ?? false;
    const paths = this.getSettablePaths({ global });

    // Convert globs to paths format
    // claudecode.paths takes precedence over globs
    const claudecodePaths = rulesyncFrontmatter.claudecode?.paths;
    const globs = rulesyncFrontmatter.globs;
    const pathsValue = claudecodePaths ?? (globs?.length ? globs : undefined);

    const claudecodeFrontmatter: ClaudecodeRuleFrontmatter = {
      paths: root ? undefined : pathsValue,
    };

    const body = rulesyncRule.getBody();

    if (root) {
      return new ClaudecodeRule({
        baseDir,
        frontmatter: claudecodeFrontmatter,
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

    return new ClaudecodeRule({
      baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      validate,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    // Convert paths field to globs array
    let globs: string[] | undefined;
    if (this.isRoot()) {
      globs = ["**/*"];
    } else if (this.frontmatter.paths) {
      // paths is already an array
      globs = this.frontmatter.paths;
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
      relativeFilePath: this.getRelativeFilePath(),
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
