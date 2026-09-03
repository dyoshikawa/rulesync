import { join } from "node:path";

import { z } from "zod/mini";

import {
  CODEBUDDY_DIR,
  CODEBUDDY_RULE_FILE_NAME,
  CODEBUDDY_RULES_DIR_NAME,
} from "../../constants/codebuddy-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
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
 * Frontmatter schema for CodeBuddy Code modular rules.
 * @see https://www.codebuddy.ai/docs/cli/memory
 */
const CodebuddyRuleFrontmatterSchema = z.object({
  description: z.optional(z.string()),
  paths: z.optional(z.array(z.string())),
  alwaysApply: z.optional(z.boolean()),
});

export type CodebuddyRuleFrontmatter = z.infer<typeof CodebuddyRuleFrontmatterSchema>;

/**
 * A universal glob (matching everything) is redundant on an Always Apply
 * rule and, paired with `alwaysApply: true`, is the same semantic conflict
 * `CursorRule.resolveCursorGlobs` avoids for Cursor: `alwaysApply` already
 * applies the rule everywhere, so also emitting an explicit
 * `paths: ["**\/*"]` is at best redundant and, on a subsequent
 * import/generate round-trip, misleadingly implies the rule is scoped by
 * path rather than always-on.
 */
const UNIVERSAL_PATHS = new Set(["**/*", "*"]);

export type CodebuddyRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: CodebuddyRuleFrontmatter;
  body: string;
};

export type CodebuddyRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  alternativeRoots?: Array<{
    relativeDirPath: string;
    relativeFilePath: string;
  }>;
  nonRoot: {
    relativeDirPath: string;
  };
};

export type CodebuddyRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for CodeBuddy Code, Tencent Cloud's terminal coding agent
 * (`@tencent-ai/codebuddy-code`). Its configuration surface mirrors Claude
 * Code closely.
 *
 * Rules format:
 * - {project}/CODEBUDDY.md (root: true), also read from {project}/.codebuddy/CODEBUDDY.md
 * - {project}/.codebuddy/rules/*.md (root: false, with optional
 *   `description` / `paths` / `alwaysApply` frontmatter)
 * - Global: ~/.codebuddy/CODEBUDDY.md and ~/.codebuddy/rules/*.md
 *
 * @see https://www.codebuddy.ai/docs/cli/memory
 * @see https://www.codebuddy.ai/docs/cli/codebuddy-dir
 */
export class CodebuddyRule extends ToolRule {
  private readonly frontmatter: CodebuddyRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): CodebuddyRuleSettablePaths | CodebuddyRuleSettablePathsGlobal {
    if (global) {
      // CodeBuddy Code reads user-scoped rules from `~/.codebuddy/rules/*.md`
      // (https://www.codebuddy.ai/docs/cli/codebuddy-dir), so global non-root
      // rules are generated there instead of being dropped.
      return {
        root: {
          relativeDirPath: buildToolPath(CODEBUDDY_DIR, ".", excludeToolDir),
          relativeFilePath: CODEBUDDY_RULE_FILE_NAME,
        },
        nonRoot: {
          relativeDirPath: buildToolPath(CODEBUDDY_DIR, CODEBUDDY_RULES_DIR_NAME, excludeToolDir),
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: CODEBUDDY_RULE_FILE_NAME,
      },
      alternativeRoots: [
        {
          relativeDirPath: CODEBUDDY_DIR,
          relativeFilePath: CODEBUDDY_RULE_FILE_NAME,
        },
      ],
      nonRoot: {
        relativeDirPath: buildToolPath(CODEBUDDY_DIR, CODEBUDDY_RULES_DIR_NAME, excludeToolDir),
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: CodebuddyRuleParams) {
    // Validate frontmatter before calling super
    if (rest.validate) {
      const result = CodebuddyRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // Root file: no frontmatter (a plain memory file); Non-root file: with
      // optional description/paths/alwaysApply frontmatter.
      fileContent: rest.root ? body : CodebuddyRule.generateFileContent(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  private static generateFileContent(body: string, frontmatter: CodebuddyRuleFrontmatter): string {
    if (
      frontmatter.description === undefined &&
      frontmatter.paths === undefined &&
      frontmatter.alwaysApply === undefined
    ) {
      return body;
    }
    return stringifyFrontmatter(body, {
      description: frontmatter.description,
      alwaysApply: frontmatter.alwaysApply,
      paths: frontmatter.paths,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
    relativeDirPath: overrideDirPath,
  }: ToolRuleFromFileParams): Promise<CodebuddyRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const rootDirPath = overrideDirPath ?? paths.root.relativeDirPath;
      const fileContent = await readFileContent(
        join(outputRoot, rootDirPath, paths.root.relativeFilePath),
      );

      return new CodebuddyRule({
        outputRoot,
        relativeDirPath: rootDirPath,
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
    const filePath = join(outputRoot, relativePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = CodebuddyRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new CodebuddyRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
      root: false,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): CodebuddyRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new CodebuddyRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: isRoot,
    });
  }

  private static resolveCodebuddyPaths({
    paths,
    alwaysApply,
  }: {
    paths: string[] | undefined;
    alwaysApply: boolean;
  }): string[] | undefined {
    if (!paths || paths.length === 0) {
      return undefined;
    }
    if (alwaysApply && paths.every((path) => UNIVERSAL_PATHS.has(path.trim()))) {
      return undefined;
    }
    return paths;
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): CodebuddyRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root ?? false;
    const paths = this.getSettablePaths({ global });
    const body = rulesyncRule.getBody();

    if (root) {
      return new CodebuddyRule({
        outputRoot,
        frontmatter: {},
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

    // codebuddy.paths takes precedence over the canonical globs.
    const codebuddyPaths = rulesyncFrontmatter.codebuddy?.paths;
    const globs = rulesyncFrontmatter.globs;
    const alwaysApply = rulesyncFrontmatter.codebuddy?.alwaysApply;
    const pathsValue = CodebuddyRule.resolveCodebuddyPaths({
      paths: codebuddyPaths ?? (globs?.length ? globs : undefined),
      alwaysApply: alwaysApply === true,
    });

    // For overlapping parameters, the tool-specific value takes precedence
    // over the shared rulesync value.
    const description =
      rulesyncFrontmatter.codebuddy?.description ?? rulesyncFrontmatter.description;

    const codebuddyFrontmatter: CodebuddyRuleFrontmatter = {
      description,
      paths: pathsValue,
      alwaysApply,
    };

    return new CodebuddyRule({
      outputRoot,
      frontmatter: codebuddyFrontmatter,
      body,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      validate,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const targets: RulesyncTargets = ["*"];

    if (this.isRoot()) {
      const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
        targets,
        root: true,
        description: this.description,
        globs: ["**/*"],
      };

      return new RulesyncRule({
        outputRoot: this.getOutputRoot(),
        frontmatter: rulesyncFrontmatter,
        body: this.body,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: this.getRelativeFilePath(),
        validate: true,
      });
    }

    // An Always Apply rule with no explicit paths is always-on for every
    // other tool too, so it maps to the universal glob, mirroring the Cursor
    // adapter's `alwaysApply` handling.
    const isAlways = this.frontmatter.alwaysApply === true;
    const sourcePaths = this.frontmatter.paths ?? [];
    const globs = sourcePaths.length === 0 && isAlways ? ["**/*"] : sourcePaths;

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs,
      ...((this.frontmatter.paths !== undefined ||
        this.frontmatter.alwaysApply !== undefined ||
        this.frontmatter.description !== undefined) && {
        codebuddy: {
          paths: this.frontmatter.paths,
          alwaysApply: this.frontmatter.alwaysApply,
          description: this.frontmatter.description,
        },
      }),
    };

    return new RulesyncRule({
      outputRoot: this.getOutputRoot(),
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

    const result = CodebuddyRuleFrontmatterSchema.safeParse(this.frontmatter);
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

  getFrontmatter(): CodebuddyRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "codebuddy",
    });
  }
}
