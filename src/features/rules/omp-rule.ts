import { join } from "node:path";

import { z } from "zod/mini";

import {
  OMP_DIR,
  OMP_GLOBAL_DIR,
  OMP_RULE_FILE_NAME,
  OMP_RULES_DIR_NAME,
} from "../../constants/omp-paths.js";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
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
  buildToolPath,
} from "./tool-rule.js";

/**
 * Frontmatter of an oh-my-pi rule file (`RuleFrontmatter` in
 * `packages/coding-agent/src/capability/rule.ts`). Only the keys rulesync
 * maps are modeled; the rest (`condition`, `scope`, `agents`, ...) pass
 * through unchanged.
 */
const OmpRuleFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  // `buildRule` accepts a single pattern or a list.
  globs: z.optional(z.union([z.string(), z.array(z.string())])),
  alwaysApply: z.optional(z.boolean()),
  // `false` makes discovery skip the file.
  enabled: z.optional(z.boolean()),
});

export type OmpRuleFrontmatter = z.infer<typeof OmpRuleFrontmatterSchema>;

export type OmpRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: OmpRuleFrontmatter;
  body: string;
};

export type OmpRuleSettablePaths = Omit<ToolRuleSettablePaths, "root" | "nonRoot"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/** Globs that match every file: equivalent to an always-apply rule. */
const UNIVERSAL_GLOBS = new Set(["**/*", "**", "*"]);

function normalizeGlobs(globs: string | string[] | undefined): string[] {
  if (globs === undefined) return [];
  return (typeof globs === "string" ? [globs] : globs).filter((glob) => glob.trim() !== "");
}

/**
 * Rule generator for oh-my-pi (`omp`).
 *
 * - Root rule: `.omp/AGENTS.md` (project) / `~/.omp/agent/AGENTS.md` (global),
 *   the native context file. It shadows a root `AGENTS.md` at the same
 *   directory depth, so the two are never loaded twice.
 * - Non-root rules: `.omp/rules/*.md` (project) / `~/.omp/agent/rules/*.md`
 *   (global) with `description` / `globs` / `alwaysApply` frontmatter.
 *
 * oh-my-pi only surfaces a rule that is `alwaysApply: true` (injected into
 * the system prompt) or has a `description` (listed in the rule index and read
 * on demand); any other rule is silently dropped. A rulesync rule with
 * universal or no globs is therefore written as `alwaysApply: true`, and a
 * glob-scoped rule without a description gets one generated from its globs,
 * as oh-my-pi itself does for glob-scoped Copilot instructions.
 *
 * `.omp/RULES.md` (sticky rule) and `.omp/SYSTEM.md` (system prompt
 * replacement) are never emitted.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/context-files.md
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/rulebook-matching-pipeline.md
 */
export class OmpRule extends ToolRule {
  private readonly frontmatter: OmpRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): OmpRuleSettablePaths {
    const dir = global ? OMP_GLOBAL_DIR : OMP_DIR;
    return {
      root: {
        relativeDirPath: buildToolPath(dir, ".", excludeToolDir),
        relativeFilePath: OMP_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(dir, OMP_RULES_DIR_NAME, excludeToolDir),
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: OmpRuleParams) {
    if (rest.validate) {
      const result = OmpRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      // The root context file is plain Markdown; rule files carry frontmatter.
      fileContent:
        rest.root || Object.values(frontmatter).every((value) => value === undefined)
          ? body
          : stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<OmpRule> {
    const paths = this.getSettablePaths({ global });
    // A `.omp/rules/AGENTS.md` is an ordinary rule file, so the file name
    // alone does not identify the root; the directory must match too.
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      (relativeDirPath === undefined || relativeDirPath === paths.root.relativeDirPath);

    if (isRoot) {
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );
      return new OmpRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body: fileContent.trim(),
        validate,
        root: true,
      });
    }

    const filePath = join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);
    const result = OmpRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new OmpRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      validate,
      root: false,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): OmpRule {
    const paths = this.getSettablePaths({ global });
    return new OmpRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root:
        relativeFilePath === paths.root.relativeFilePath &&
        relativeDirPath === paths.root.relativeDirPath,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): OmpRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const paths = this.getSettablePaths({ global });
    const body = rulesyncRule.getBody();

    if (rulesyncFrontmatter.root) {
      return new OmpRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body,
        validate,
        root: true,
      });
    }

    const globs = normalizeGlobs(rulesyncFrontmatter.globs);
    const scopedGlobs = globs.every((glob) => UNIVERSAL_GLOBS.has(glob.trim())) ? [] : globs;
    const frontmatter: OmpRuleFrontmatter =
      scopedGlobs.length === 0
        ? { description: rulesyncFrontmatter.description, alwaysApply: true }
        : {
            description:
              rulesyncFrontmatter.description ??
              `Rules for files matching ${scopedGlobs.join(", ")}`,
            globs: scopedGlobs,
          };

    return new OmpRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter,
      body,
      validate,
      root: false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const scopedGlobs = normalizeGlobs(this.frontmatter.globs);
    const rulesyncFrontmatter: RulesyncRuleFrontmatter = this.isRoot()
      ? { targets: ["*"], root: true, description: this.description, globs: ["**/*"] }
      : {
          targets: ["*"],
          root: false,
          description: this.frontmatter.description,
          globs:
            this.frontmatter.alwaysApply === true || scopedGlobs.length === 0
              ? ["**/*"]
              : scopedGlobs,
        };

    return new RulesyncRule({
      outputRoot: this.getOutputRoot(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.isRoot() ? RULESYNC_OVERVIEW_FILE_NAME : this.getRelativeFilePath(),
      validate: true,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = OmpRuleFrontmatterSchema.safeParse(this.frontmatter);
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

  getFrontmatter(): OmpRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "omp",
    });
  }
}
