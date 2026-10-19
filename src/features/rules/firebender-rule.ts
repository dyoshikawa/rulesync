import { join } from "node:path";

import { z } from "zod/mini";

import {
  FIREBENDER_AGENTS_MD_FILE_NAME,
  FIREBENDER_DIR,
} from "../../constants/firebender-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { expandBraceAlternations } from "../../utils/brace-aware-list.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { CursorRule } from "./cursor-rule.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  buildToolPath,
} from "./tool-rule.js";

/**
 * Frontmatter of a Firebender `.mdc` rule. Every field is optional; `globs`
 * is one comma-separated string, and a YAML list is tolerated on import.
 */
const FirebenderRuleFrontmatterSchema = z.looseObject({
  description: z.optional(z.nullable(z.string())),
  globs: z.optional(z.nullable(z.union([z.string(), z.array(z.string())]))),
  alwaysApply: z.optional(z.nullable(z.boolean())),
});

export type FirebenderRuleFrontmatter = z.infer<typeof FirebenderRuleFrontmatterSchema>;

/** Globs that match every file, and so add nothing to an always-applied rule. */
const UNIVERSAL_GLOBS = new Set(["**/*", "*"]);

export type FirebenderRuleSettablePaths = {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

type FirebenderRuleParams = ToolRuleParams & {
  frontmatter?: FirebenderRuleFrontmatter;
  body?: string;
};

function normalizeGlobs(globs: string | string[] | null | undefined): string[] {
  if (globs === null || globs === undefined) {
    return [];
  }
  const list = typeof globs === "string" ? globs.split(",") : globs;
  return list.map((glob) => glob.trim()).filter((glob) => glob.length > 0);
}

/**
 * Rule generator for Firebender.
 *
 * Root rule: Firebender looks for `.firebender/AGENTS.md` first (then the
 * project-root `AGENTS.md`, then the same pair in parent directories, then
 * `~/.firebender/AGENTS.md`) and uses the first file it finds, so the root rule
 * is written to `.firebender/AGENTS.md` in the project and to
 * `~/.firebender/AGENTS.md` globally, where it does not collide with the
 * project-root `AGENTS.md` the `agentsmd` target owns.
 *
 * Non-root rules: `.firebender/rules/*.mdc` (project) and
 * `~/.firebender/rules/*.mdc` (personal), each with optional Cursor-style
 * frontmatter: `description`, `globs` (one comma-separated string) and
 * `alwaysApply`. A rule with specific globs is written with
 * `alwaysApply: false` and those globs; every other rule is always applied.
 *
 * @see https://docs.firebender.com/api-reference/rules
 * @see https://docs.firebender.com/api-reference/agents-md
 */
export class FirebenderRule extends ToolRule {
  private readonly frontmatter: FirebenderRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter = {}, body, ...rest }: FirebenderRuleParams) {
    if (rest.validate && !rest.root) {
      const result = FirebenderRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }
    const resolvedBody = body ?? rest.fileContent;
    super({
      ...rest,
      fileContent: rest.root
        ? resolvedBody
        : stringifyFrontmatter(resolvedBody, FirebenderRule.toOutputFrontmatter(frontmatter), {
            avoidBlockScalars: true,
          }),
    });
    this.frontmatter = frontmatter;
    this.body = resolvedBody;
  }

  static getSettablePaths({
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): FirebenderRuleSettablePaths {
    // Both scopes share the same layout; the home-directory root is applied by
    // the processor in global mode.
    return {
      root: {
        relativeDirPath: buildToolPath(FIREBENDER_DIR, ".", excludeToolDir),
        relativeFilePath: FIREBENDER_AGENTS_MD_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(FIREBENDER_DIR, "rules", excludeToolDir),
      },
    };
  }

  /**
   * The frontmatter written to a `.mdc` file: `alwaysApply` first, then the
   * flattened `description`, then the globs joined the way Firebender's docs
   * spell them (`"*.kt, *.kts"`).
   */
  private static toOutputFrontmatter(
    frontmatter: FirebenderRuleFrontmatter,
  ): Record<string, unknown> {
    const description =
      typeof frontmatter.description === "string"
        ? frontmatter.description.replace(/[\r\n\u0085\u2028\u2029]+/g, " ").trim()
        : "";
    const globs = normalizeGlobs(frontmatter.globs);
    return {
      ...(typeof frontmatter.alwaysApply === "boolean" && {
        alwaysApply: frontmatter.alwaysApply,
      }),
      ...(description !== "" && { description }),
      ...(globs.length > 0 && { globs: globs.join(", ") }),
    };
  }

  /**
   * Derives the Firebender frontmatter from the canonical one: specific globs
   * make a file-scoped rule, everything else (no globs, universal globs) is
   * always applied. Firebender splits `globs` on every comma, so a brace
   * alternation such as `*.{ts,tsx}` is expanded into one glob per branch.
   */
  private static buildFrontmatter(frontmatter: RulesyncRuleFrontmatter): FirebenderRuleFrontmatter {
    const globs = normalizeGlobs(frontmatter.globs ?? []).flatMap((glob) =>
      expandBraceAlternations(glob),
    );
    const specificGlobs = globs.filter((glob) => !UNIVERSAL_GLOBS.has(glob));
    const isFileScoped = specificGlobs.length > 0 && specificGlobs.length === globs.length;
    const description = frontmatter.description?.trim() || undefined;
    return {
      alwaysApply: !isFileScoped,
      ...(description !== undefined && { description }),
      ...(isFileScoped && { globs: specificGlobs.join(", ") }),
    };
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): FirebenderRule {
    const paths = this.getSettablePaths();
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const isRoot = rulesyncFrontmatter.root ?? false;

    if (isRoot) {
      return new FirebenderRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: true,
        description: rulesyncFrontmatter.description,
        globs: rulesyncFrontmatter.globs,
      });
    }

    return new FirebenderRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath().replace(/\.md$/, ".mdc"),
      frontmatter: this.buildFrontmatter(rulesyncFrontmatter),
      body: rulesyncRule.getBody(),
      fileContent: "",
      validate,
      root: false,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<FirebenderRule> {
    const paths = this.getSettablePaths();
    // A `.firebender/rules/AGENTS.md` would not be a rule at all (rules are
    // `.mdc`), but the directory is still compared so the root is never
    // inferred from the file name alone.
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      (relativeDirPath === undefined || relativeDirPath === paths.root.relativeDirPath);

    if (isRoot) {
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );
      return new FirebenderRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    const filePath = join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = CursorRule.parseCursorFrontmatter(fileContent, filePath);
    const result = FirebenderRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new FirebenderRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      fileContent: "",
      validate,
      root: false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    if (this.isRoot()) {
      return this.toRulesyncRuleDefault();
    }

    const sourceGlobs = normalizeGlobs(this.frontmatter.globs);
    const alwaysApply = this.frontmatter.alwaysApply ?? undefined;
    const description = this.frontmatter.description?.trim() || undefined;
    // `alwaysApply: true` wins over `globs` in Firebender, and a rule with no
    // globs (no frontmatter at all included) applies to every file, so both
    // become `**/*` for the other tools.
    const globs = alwaysApply === true || sourceGlobs.length === 0 ? ["**/*"] : sourceGlobs;

    return new RulesyncRule({
      outputRoot: process.cwd(),
      frontmatter: {
        targets: ["*"],
        root: false,
        ...(description !== undefined && { description }),
        globs,
      },
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.mdc$/, ".md"),
      validate: true,
    });
  }

  validate(): ValidationResult {
    if (this.isRoot() || !this.frontmatter) {
      return { success: true, error: null };
    }
    const result = FirebenderRuleFrontmatterSchema.safeParse(this.frontmatter);
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

  getFrontmatter(): FirebenderRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): FirebenderRule {
    const paths = this.getSettablePaths();
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      relativeDirPath === paths.root.relativeDirPath;
    return new FirebenderRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "firebender",
    });
  }
}
