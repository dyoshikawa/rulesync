import { join } from "node:path";

import { z } from "zod/mini";

import { CONTINUE_DIR, CONTINUE_ROOT_RULE_FILE_NAME } from "../../constants/continue-paths.js";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
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
 * Frontmatter schema for Continue rule files (`.continue/rules/*.md`).
 * `globs` and `regex` are documented as either a single pattern or a list.
 * @see https://docs.continue.dev/customize/deep-dives/rules
 */
const ContinueRuleFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  globs: z.optional(z.union([z.string(), z.array(z.string())])),
  regex: z.optional(z.union([z.string(), z.array(z.string())])),
  alwaysApply: z.optional(z.boolean()),
});

export type ContinueRuleFrontmatter = z.infer<typeof ContinueRuleFrontmatterSchema>;

/**
 * Normalizes the documented `string` / `string[]` shapes to the list form the
 * adapter works with. Continue treats a scalar as one pattern (no comma
 * splitting), so the scalar simply becomes a one-element list. An empty list
 * and an empty string both mean "not set".
 */
function normalizePatternList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const list = (typeof value === "string" ? [value] : value).filter(
    (pattern) => pattern.trim() !== "",
  );
  return list.length > 0 ? list : undefined;
}

/**
 * A universal glob is redundant on a Continue rule: a `.continue/rules/` file
 * with no `globs` is already implicitly always-on, and one with `globs` is
 * only pulled in when a context file matches, so emitting `**\/*` would turn
 * an always-on rule into a "when any file is in context" rule. Dropped on
 * generate and mapped back on import.
 */
const UNIVERSAL_GLOBS = new Set(["**/*", "*"]);

export type ContinueRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: ContinueRuleFrontmatter;
  body: string;
};

export type ContinueRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export type ContinueRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal & {
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for Continue (continuedev/continue), the open-source IDE
 * extension and CLI (`cn`).
 *
 * Rules format:
 * - {project}/AGENTS.md (root: true) — read from the workspace root and
 *   always applied.
 * - {project}/.continue/rules/*.md (root: false) — Markdown with optional
 *   `description` / `globs` / `regex` / `alwaysApply` frontmatter. A file
 *   with no `globs`/`regex` is always applied; one with `globs` is applied
 *   when a context file matches; `alwaysApply: true` forces it on and
 *   `alwaysApply: false` makes it depend on `globs`/`regex` only.
 * - Global: ~/.continue/rules/*.md. Continue does not read `~/AGENTS.md`, so
 *   the global root rule is written to `~/.continue/rules/AGENTS.md`, the
 *   same layout the Roo adapter uses.
 *
 * @see https://docs.continue.dev/customize/deep-dives/rules
 */
export class ContinueRule extends ToolRule {
  private readonly frontmatter: ContinueRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ContinueRuleSettablePaths | ContinueRuleSettablePathsGlobal {
    const rulesDirPath = buildToolPath(CONTINUE_DIR, "rules", excludeToolDir);
    if (global) {
      return {
        root: {
          relativeDirPath: rulesDirPath,
          relativeFilePath: CONTINUE_ROOT_RULE_FILE_NAME,
        },
        nonRoot: {
          relativeDirPath: rulesDirPath,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: CONTINUE_ROOT_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: rulesDirPath,
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: ContinueRuleParams) {
    if (rest.validate) {
      const result = ContinueRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // Root file: a plain AGENTS.md; non-root file: optional frontmatter.
      fileContent: rest.root ? body : ContinueRule.generateFileContent(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  private static generateFileContent(body: string, frontmatter: ContinueRuleFrontmatter): string {
    if (
      frontmatter.description === undefined &&
      frontmatter.globs === undefined &&
      frontmatter.regex === undefined &&
      frontmatter.alwaysApply === undefined
    ) {
      return body;
    }
    return stringifyFrontmatter(body, {
      description: frontmatter.description,
      globs: frontmatter.globs,
      regex: frontmatter.regex,
      alwaysApply: frontmatter.alwaysApply,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
    relativeDirPath: overrideDirPath,
  }: ToolRuleFromFileParams): Promise<ContinueRule> {
    const paths = this.getSettablePaths({ global });
    // In global scope the root rule shares the rules directory with the
    // non-root files, so the basename is what tells them apart on import.
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const rootDirPath = overrideDirPath ?? paths.root.relativeDirPath;
      const fileContent = await readFileContent(
        join(outputRoot, rootDirPath, paths.root.relativeFilePath),
      );

      return new ContinueRule({
        outputRoot,
        relativeDirPath: rootDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body: fileContent.trim(),
        validate,
        root: true,
      });
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const filePath = join(outputRoot, relativePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = ContinueRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ContinueRule({
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
  }: ToolRuleForDeletionParams): ContinueRule {
    const paths = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      relativeDirPath === paths.root.relativeDirPath;

    return new ContinueRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: isRoot,
    });
  }

  /**
   * Resolves the `globs` to emit. A universal glob is dropped because a rule
   * without `globs` is already always-on in Continue (see `UNIVERSAL_GLOBS`),
   * and it is also dropped alongside `alwaysApply: true`, which ignores it.
   */
  private static resolveContinueGlobs({
    continueGlobs,
    parentGlobs,
  }: {
    continueGlobs: string[] | undefined;
    parentGlobs: string[] | undefined;
  }): string[] | undefined {
    const targetGlobs = continueGlobs ?? parentGlobs;
    if (!targetGlobs || targetGlobs.length === 0) {
      return undefined;
    }
    if (targetGlobs.every((glob) => UNIVERSAL_GLOBS.has(glob.trim()))) {
      return undefined;
    }
    return targetGlobs;
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ContinueRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root ?? false;
    const paths = this.getSettablePaths({ global });
    const body = rulesyncRule.getBody();

    if (root) {
      return new ContinueRule({
        outputRoot,
        frontmatter: {},
        body,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        validate,
        root,
      });
    }

    const continueFrontmatter = rulesyncFrontmatter.continue;
    // continue.globs takes precedence over the canonical globs, and the
    // tool-specific description over the shared one.
    const continueRuleFrontmatter: ContinueRuleFrontmatter = {
      description: continueFrontmatter?.description ?? rulesyncFrontmatter.description,
      globs: ContinueRule.resolveContinueGlobs({
        continueGlobs: normalizePatternList(continueFrontmatter?.globs),
        parentGlobs: rulesyncFrontmatter.globs,
      }),
      regex: normalizePatternList(continueFrontmatter?.regex),
      alwaysApply: continueFrontmatter?.alwaysApply,
    };

    return new ContinueRule({
      outputRoot,
      frontmatter: continueRuleFrontmatter,
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

      // The root rule lands on the canonical `overview.md` (as every other
      // target does) rather than on `AGENTS.md`.
      return new RulesyncRule({
        outputRoot: this.getOutputRoot(),
        frontmatter: rulesyncFrontmatter,
        body: this.body,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_OVERVIEW_FILE_NAME,
        validate: true,
      });
    }

    // A rule with no `globs` is always-on unless `alwaysApply: false` turns it
    // into a regex/agent-selected rule, so it maps to the universal glob; a
    // rule with `globs` keeps them as the canonical scope.
    const sourceGlobs = normalizePatternList(this.frontmatter.globs) ?? [];
    const regex = normalizePatternList(this.frontmatter.regex);
    const isAlways = this.frontmatter.alwaysApply !== false;
    const globs = sourceGlobs.length === 0 && isAlways ? ["**/*"] : sourceGlobs;

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs,
      ...((this.frontmatter.alwaysApply !== undefined || regex !== undefined) && {
        continue: {
          alwaysApply: this.frontmatter.alwaysApply,
          regex,
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

    const result = ContinueRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  getFrontmatter(): ContinueRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "continue",
    });
  }
}
