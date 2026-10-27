import { join } from "node:path";

import { z } from "zod/mini";

import { AGENTSMD_DIR, AGENTSMD_RULE_FILE_NAME } from "../../constants/agentsmd-paths.js";
import { CLINE_RULES_GLOBAL_DIR_PATH, CLINERULES_DIR } from "../../constants/cline-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { warnWithFallback } from "../../utils/logger.js";
import { RulesyncRule } from "./rulesync-rule.js";
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
 * Frontmatter schema for Cline conditional-activation rules (`.clinerules/*.md`).
 *
 * Cline rule files support YAML frontmatter for conditional activation:
 * - `paths`: glob array. When present, the rule is *conditional* and is only
 *   loaded when a file matching one of the patterns is in the current context.
 * - `alwaysApply: true`: force the rule to always load (equivalent to a file
 *   with no frontmatter at all).
 * - `description`: label surfaced in the rule toggle UI.
 * - `disabled: true` (or `enabled: false`): the rule is switched off. Since
 *   Cline v4.1.26 (cline/cline#14605) the rule toggle writes this flag into the
 *   rule file itself instead of keeping it only in extension state.
 *
 * Rules without frontmatter are always active. Uses `z.looseObject()` so
 * forward-compatible fields added upstream are preserved on round-trip: every
 * key other than `paths` / `alwaysApply` / `description` is carried in the
 * rulesync `cline:` section.
 *
 * @see https://docs.cline.bot/customization/cline-rules
 * @see https://github.com/cline/cline/blob/main/sdk/packages/core/src/extensions/config/user-instruction-config-loader.ts
 */
export const ClineRuleFrontmatterSchema = z.looseObject({
  paths: z.optional(z.union([z.array(z.string()), z.string()])),
  alwaysApply: z.optional(z.boolean()),
  description: z.optional(z.string()),
});

export type ClineRuleFrontmatter = z.infer<typeof ClineRuleFrontmatterSchema>;

// The rule frontmatter fields Cline type-checks besides the canonical ones. A
// value of the wrong type makes Cline reject the whole rule file ("Frontmatter
// field 'disabled' must be a boolean."), and would fail the rulesync `cline:`
// schema, so such a value is dropped with a warning on import.
const CLINE_RULE_FIELD_TYPES: Record<string, "boolean"> = {
  disabled: "boolean",
  enabled: "boolean",
};

// Cline rule frontmatter keys with canonical rulesync homes (`globs` and
// `description`); they are never carried in the `cline:` section.
const CANONICAL_CLINE_RULE_KEYS = ["paths", "alwaysApply", "description"] as const;

/** Returns a copy of `record` without the canonical `paths` / `alwaysApply` / `description` keys. */
function omitCanonicalClineRuleKeys(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record ?? {}).filter(
      ([key]) => !(CANONICAL_CLINE_RULE_KEYS as readonly string[]).includes(key),
    ),
  );
}

/**
 * Splits a Cline rule frontmatter into the keys that have canonical rulesync
 * homes (`paths` / `alwaysApply` / `description`) and the rest, which are
 * lifted into the rulesync `cline:` section.
 */
function extractClineSection({
  frontmatter,
  relativeFilePath,
}: {
  frontmatter: ClineRuleFrontmatter | undefined;
  relativeFilePath: string;
}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(omitCanonicalClineRuleKeys(frontmatter)).filter(([key, value]) => {
      const expected = Object.hasOwn(CLINE_RULE_FIELD_TYPES, key)
        ? CLINE_RULE_FIELD_TYPES[key]
        : undefined;
      if (expected === undefined || value === undefined || typeof value === expected) {
        return true;
      }
      warnWithFallback(
        undefined,
        `Cline rules: dropping ${key} from ${relativeFilePath}: Cline rejects the whole rule unless it is a ${expected}.`,
      );
      return false;
    }),
  );
}

/**
 * Parameters for creating a non-root ClineRule (`.clinerules/*.md`).
 * These rules carry YAML frontmatter, so the body and frontmatter are passed
 * separately instead of a combined `fileContent`.
 */
type ClineRuleNonRootParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: ClineRuleFrontmatter;
  body: string;
};

/**
 * Parameters for creating a root ClineRule. The root memory file (project
 * `AGENTS.md` / global `~/.agents/AGENTS.md`) is plain Markdown without
 * frontmatter, so `fileContent` is passed directly.
 */
type ClineRuleRootParams = ToolRuleParams;

export type ClineRuleParams = ClineRuleNonRootParams | ClineRuleRootParams;

export type ClineRuleSettablePaths = Pick<ToolRuleSettablePaths, "nonRoot">;

export type ClineRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal & {
  nonRoot: {
    relativeDirPath: string;
  };
};

function isNonRootParams(params: ClineRuleParams): params is ClineRuleNonRootParams {
  return "frontmatter" in params && "body" in params;
}

/**
 * Converts a `paths` frontmatter value (array or comma-tolerant string) into a
 * normalized string array. Returns an empty array when unset.
 */
function normalizePaths(paths: string[] | string | undefined): string[] {
  if (!paths) {
    return [];
  }
  if (Array.isArray(paths)) {
    return paths.filter((p) => p.trim().length > 0);
  }
  if (paths.trim() === "") {
    return [];
  }
  return [paths.trim()];
}

/**
 * Rule generator for Cline.
 *
 * - Project scope: a flat `.clinerules/*.md` directory of rule files. Non-root
 *   rules carry YAML frontmatter mapping rulesync `globs` to Cline's `paths`
 *   (conditional activation) and rulesync `description` to `description`.
 *   Universal match-everything globs map to `alwaysApply: true`; rules without
 *   globs are emitted as plain Markdown (always active). The single root rule is
 *   emitted to the project `AGENTS.md` as plain Markdown.
 * - Global scope: a single cross-tool `~/.agents/AGENTS.md` file. Cline reads
 *   global AGENTS rules from `~/.agents/AGENTS.md` (introduced in Cline CLI
 *   v3.0.15, 2026-05-29), following the agents.md standard, so global rules are
 *   applied across all sessions and projects.
 */
export class ClineRule extends ToolRule {
  private readonly frontmatter: ClineRuleFrontmatter | undefined;
  private readonly body: string | undefined;

  constructor(params: ClineRuleParams) {
    if (isNonRootParams(params)) {
      const { frontmatter, body, ...rest } = params;
      if (rest.validate !== false) {
        const result = ClineRuleFrontmatterSchema.safeParse(frontmatter);
        if (!result.success) {
          throw new Error(
            `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
          );
        }
      }

      super({
        ...rest,
        fileContent: ClineRule.buildNonRootFileContent({ body, frontmatter }),
      });
      this.frontmatter = frontmatter;
      this.body = body;
      return;
    }

    super(params);
    this.frontmatter = undefined;
    this.body = undefined;
  }

  /**
   * Builds the file content for a non-root rule. When the frontmatter is empty
   * (no `paths`/`alwaysApply`/`description`), the body is emitted as plain
   * Markdown without a frontmatter block, keeping always-active rules clean.
   */
  private static buildNonRootFileContent({
    body,
    frontmatter,
  }: {
    body: string;
    frontmatter: ClineRuleFrontmatter;
  }): string {
    const hasFrontmatter = Object.values(frontmatter).some((value) =>
      Array.isArray(value) ? value.length > 0 : value !== undefined && value !== "",
    );
    if (!hasFrontmatter) {
      return body;
    }
    return stringifyFrontmatter(body, frontmatter);
  }

  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ClineRuleSettablePaths | ClineRuleSettablePathsGlobal {
    if (global) {
      // Cline reads global agent rules from the cross-tool `~/.agents/AGENTS.md`
      // location (the agents.md standard), not a `.cline`-prefixed tool dir.
      return {
        root: {
          relativeDirPath: buildToolPath(AGENTSMD_DIR, ".", excludeToolDir),
          relativeFilePath: AGENTSMD_RULE_FILE_NAME,
        },
        // Global modular rules: `~/Documents/Cline/Rules/*.md` is read by the
        // VS Code extension and the SDK/CLI alike (the SDK/CLI also reads
        // `~/.cline/rules/`), so non-root global rules are no longer dropped.
        nonRoot: {
          relativeDirPath: CLINE_RULES_GLOBAL_DIR_PATH,
        },
      };
    }
    return {
      nonRoot: {
        // .clinerules is a flat directory, so excludeToolDir has no effect
        relativeDirPath: CLINERULES_DIR,
      },
    };
  }

  toRulesyncRule(): RulesyncRule {
    if (this.isRoot()) {
      return this.toRulesyncRuleDefault();
    }

    const globs =
      this.frontmatter?.alwaysApply === true ? ["**/*"] : normalizePaths(this.frontmatter?.paths);
    // Keys beyond the canonical ones — notably `disabled: true`, which Cline's
    // rule toggle writes — are lifted into `cline:` so they survive a
    // regenerate.
    const cline = extractClineSection({
      frontmatter: this.frontmatter,
      relativeFilePath: this.getRelativeFilePath(),
    });

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        description: this.frontmatter?.description,
        globs,
        ...(Object.keys(cline).length > 0 && { cline }),
      },
      body: this.body ?? this.getFileContent(),
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const isRoot = rulesyncFrontmatter.root ?? false;

    if (global) {
      const paths = this.getSettablePaths({ global: true });
      if (!("root" in paths)) {
        throw new Error("ClineRule global settable paths must include a root path");
      }
      if (!isRoot) {
        // Non-root global rules land in `~/Documents/Cline/Rules/*.md` with the
        // same conditional frontmatter conversion project rules get.
        return this.buildNonRootRule({
          outputRoot,
          rulesyncRule,
          validate,
          relativeDirPath: CLINE_RULES_GLOBAL_DIR_PATH,
        });
      }
      return new ClineRule(
        this.buildToolRuleParamsAgentsmd({
          outputRoot,
          rulesyncRule,
          validate,
          rootPath: paths.root,
          global,
        }),
      );
    }

    // Project scope. The single root rule lands in the plain `AGENTS.md` memory
    // file; non-root rules become `.clinerules/*.md` with conditional frontmatter.
    if (isRoot) {
      return new ClineRule({
        outputRoot,
        relativeDirPath: ".",
        relativeFilePath: AGENTSMD_RULE_FILE_NAME,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: true,
      });
    }

    return this.buildNonRootRule({
      outputRoot,
      rulesyncRule,
      validate,
      relativeDirPath: CLINERULES_DIR,
    });
  }

  /**
   * Builds a non-root rule file (project `.clinerules/*.md` or global
   * `~/Documents/Cline/Rules`). Maps rulesync `globs` -> Cline `paths`:
   * universal match-everything globs mean "always", so they map to
   * `alwaysApply: true` instead of a `paths` list; specific globs become
   * conditional `paths`; an empty globs list leaves the rule always-active with
   * no `paths`/`alwaysApply`. Every key of the rulesync `cline:` section
   * (e.g. `disabled: true`) is written into the frontmatter too; the canonical
   * `paths` / `alwaysApply` / `description` win over same-named keys there.
   */
  private static buildNonRootRule({
    outputRoot,
    rulesyncRule,
    validate,
    relativeDirPath,
  }: {
    outputRoot: string;
    rulesyncRule: RulesyncRule;
    validate: boolean;
    relativeDirPath: string;
  }): ClineRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const globs = normalizePaths(rulesyncFrontmatter.globs);
    const isUniversal = globs.length > 0 && globs.every((glob) => glob === "**/*" || glob === "*");
    const rawClineSection = rulesyncFrontmatter.cline ?? {};
    for (const key of CANONICAL_CLINE_RULE_KEYS) {
      if (Object.hasOwn(rawClineSection, key)) {
        warnWithFallback(
          undefined,
          `Cline rules: ignoring cline.${key} in ${rulesyncRule.getRelativeFilePath()}: set the canonical ${key === "description" ? "description" : "globs"} instead.`,
        );
      }
    }
    const clineSection = omitCanonicalClineRuleKeys(rawClineSection);
    const frontmatter: ClineRuleFrontmatter = {
      paths: globs.length > 0 && !isUniversal ? globs : undefined,
      alwaysApply: isUniversal ? true : undefined,
      // Omit empty descriptions so they do not leave a bare `description: ''`
      // line in the emitted frontmatter.
      description: rulesyncFrontmatter.description || undefined,
      ...clineSection,
    };

    return new ClineRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ClineRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return { success: false, error: new Error(formatError(result.error)) };
    }
    return { success: true, error: null };
  }

  getFrontmatter(): ClineRuleFrontmatter | undefined {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body ?? this.getFileContent();
  }

  protected static override readonly toolTarget = "cline";

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<ClineRule> {
    if (global) {
      const paths = this.getSettablePaths({ global: true });
      if (!("root" in paths)) {
        throw new Error("ClineRule global settable paths must include a root path");
      }
      if (relativeFilePath === paths.root.relativeFilePath) {
        const fileContent = await readFileContent(
          join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
        );

        return new ClineRule({
          outputRoot,
          relativeDirPath: paths.root.relativeDirPath,
          relativeFilePath: paths.root.relativeFilePath,
          fileContent,
          validate,
          root: true,
        });
      }
      // A non-root global rule from `~/Documents/Cline/Rules/*.md`.
      return this.fromNonRootFile({
        outputRoot,
        relativeDirPath: CLINE_RULES_GLOBAL_DIR_PATH,
        relativeFilePath,
        validate,
      });
    }

    const paths = this.getSettablePaths();
    if (!paths.nonRoot) {
      throw new Error("ClineRule project settable paths must include a nonRoot path");
    }

    return this.fromNonRootFile({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  private static async fromNonRootFile({
    outputRoot,
    relativeDirPath,
    relativeFilePath,
    validate,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    relativeFilePath: string;
    validate: boolean;
  }): Promise<ClineRule> {
    const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    let parsedFrontmatter: ClineRuleFrontmatter;
    if (validate) {
      const result = ClineRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
      }
      parsedFrontmatter = result.data;
    } else {
      parsedFrontmatter = frontmatter as ClineRuleFrontmatter;
    }

    return new ClineRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: parsedFrontmatter,
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
  }: ToolRuleForDeletionParams): ClineRule {
    if (global) {
      return new ClineRule({
        outputRoot,
        relativeDirPath,
        relativeFilePath,
        fileContent: "",
        validate: false,
        root: true,
      });
    }

    return new ClineRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: false,
    });
  }
}
