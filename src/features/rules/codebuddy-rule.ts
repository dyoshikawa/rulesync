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
  // Documented as `string`/`string[]`, and every example in the Rule Control
  // Fields section uses the bare-string form, so both have to parse.
  paths: z.optional(z.union([z.string(), z.array(z.string())])),
  alwaysApply: z.optional(z.boolean()),
  // Defaults to `true`; `false` makes CodeBuddy skip loading the rule
  // entirely, so it has to survive an import/generate round trip.
  enabled: z.optional(z.boolean()),
});

export type CodebuddyRuleFrontmatter = z.infer<typeof CodebuddyRuleFrontmatterSchema>;

/**
 * Splits a scalar `paths` value on the commas that separate patterns, leaving
 * the commas inside a brace group alone: CodeBuddy's memory docs say "You can
 * also combine multiple patterns with commas" and give
 * `paths: {src,lib}/**\/*.ts, tests/**\/*.test.ts` as the example, where the
 * first comma belongs to the brace expansion and the second separates the two
 * globs. Only a scalar is split — the docs describe the comma form for the
 * string shape, and a list already separates its patterns.
 */
function splitCodebuddyPathsScalar(paths: string): string[] {
  const patterns: string[] = [];
  let current = "";
  let braceDepth = 0;
  for (const char of paths) {
    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === "," && braceDepth === 0) {
      patterns.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  patterns.push(current);
  return patterns.map((pattern) => pattern.trim());
}

/**
 * Normalizes the documented `string` / `string[]` shapes of `paths` to the
 * list form the rest of the adapter works with, splitting a comma-separated
 * scalar into its patterns (see `splitCodebuddyPathsScalar`). An empty list
 * and an empty string both mean "no paths".
 */
function normalizeCodebuddyPaths(paths: string | string[] | undefined): string[] | undefined {
  if (paths === undefined) {
    return undefined;
  }
  const list = (typeof paths === "string" ? splitCodebuddyPathsScalar(paths) : paths).filter(
    (path) => path.trim() !== "",
  );
  return list.length > 0 ? list : undefined;
}

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
 *   `description` / `paths` / `alwaysApply` / `enabled` frontmatter)
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
      // optional description/enabled/alwaysApply/paths frontmatter.
      fileContent: rest.root ? body : CodebuddyRule.generateFileContent(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  private static generateFileContent(body: string, frontmatter: CodebuddyRuleFrontmatter): string {
    if (
      frontmatter.description === undefined &&
      frontmatter.paths === undefined &&
      frontmatter.alwaysApply === undefined &&
      frontmatter.enabled === undefined
    ) {
      return body;
    }
    return stringifyFrontmatter(body, {
      description: frontmatter.description,
      enabled: frontmatter.enabled,
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

  /**
   * Resolves the `paths` / `alwaysApply` pair against CodeBuddy's Rule Type
   * Determination table, which reads:
   *
   * | `alwaysApply`    | `paths`   | Rule type                          |
   * | ---------------- | --------- | ---------------------------------- |
   * | `true` (default) | any       | ALWAYS — always injected            |
   * | `false`          | has value | MANUAL — triggered on matching file |
   * | `false`          | none      | not supported; the rule is dropped  |
   *
   * The default being `true` is the opposite of Cursor, which the adapter was
   * modeled on: `paths` alone scopes nothing, so a rule meant to be path
   * triggered has to carry an explicit `alwaysApply: false` alongside it.
   *
   * @see https://www.codebuddy.ai/docs/cli/memory
   */
  private static resolveCodebuddyRuleType({
    paths,
    alwaysApply,
  }: {
    paths: string[] | undefined;
    alwaysApply: boolean | undefined;
  }): Pick<CodebuddyRuleFrontmatter, "paths" | "alwaysApply"> {
    const scopedPaths =
      paths && paths.length > 0 && !paths.every((path) => UNIVERSAL_PATHS.has(path.trim()))
        ? paths
        : undefined;

    if (alwaysApply === true) {
      // ALWAYS ignores `paths`, so a universal glob is pure noise; a scoped
      // one is kept because dropping it would lose the author's intent.
      return { paths: scopedPaths, alwaysApply: true };
    }
    if (scopedPaths === undefined) {
      // `alwaysApply: false` with no paths is the row CodeBuddy refuses to
      // load, so leave the key implicit and let the documented default apply
      // rather than emitting a rule the tool silently ignores.
      return { paths: undefined, alwaysApply: undefined };
    }
    return { paths: scopedPaths, alwaysApply: false };
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
    const codebuddyPaths = normalizeCodebuddyPaths(rulesyncFrontmatter.codebuddy?.paths);
    const globs = rulesyncFrontmatter.globs;
    const ruleType = CodebuddyRule.resolveCodebuddyRuleType({
      paths: codebuddyPaths ?? (globs?.length ? globs : undefined),
      alwaysApply: rulesyncFrontmatter.codebuddy?.alwaysApply,
    });

    // For overlapping parameters, the tool-specific value takes precedence
    // over the shared rulesync value.
    const description =
      rulesyncFrontmatter.codebuddy?.description ?? rulesyncFrontmatter.description;

    const codebuddyFrontmatter: CodebuddyRuleFrontmatter = {
      description,
      paths: ruleType.paths,
      alwaysApply: ruleType.alwaysApply,
      enabled: rulesyncFrontmatter.codebuddy?.enabled,
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
    // adapter's `alwaysApply` handling. `alwaysApply` defaults to `true`
    // upstream, so only an explicit `false` makes a rule path triggered.
    const sourcePaths = normalizeCodebuddyPaths(this.frontmatter.paths) ?? [];
    const isAlways = this.frontmatter.alwaysApply !== false;
    const globs = sourcePaths.length === 0 && isAlways ? ["**/*"] : sourcePaths;
    // Materialize that default when the file also carries `paths`: the rule is
    // ALWAYS and ignores them, so leaving the key implicit would let the next
    // generate read the paths as a scope and downgrade the rule to MANUAL.
    const alwaysApply = this.frontmatter.alwaysApply ?? (sourcePaths.length > 0 ? true : undefined);

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs,
      ...((this.frontmatter.paths !== undefined ||
        this.frontmatter.alwaysApply !== undefined ||
        this.frontmatter.enabled !== undefined ||
        this.frontmatter.description !== undefined) && {
        codebuddy: {
          paths: sourcePaths.length > 0 ? sourcePaths : undefined,
          alwaysApply,
          enabled: this.frontmatter.enabled,
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
