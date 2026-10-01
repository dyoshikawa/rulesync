import { join } from "node:path";

import { dump } from "js-yaml";
import { z } from "zod/mini";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { TRAE_DIR } from "../../constants/trae-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { expandBraceAlternations, splitBraceAwareList } from "../../utils/brace-aware-list.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { findFrontmatterBlockBounds, parseFrontmatter } from "../../utils/frontmatter.js";
import { warnWithFallback } from "../../utils/logger.js";
import { CursorRule } from "./cursor-rule.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

/**
 * Frontmatter of a Trae project rule. Trae's rule editor writes Cursor's
 * `alwaysApply` / `description` / `globs` triple, with `globs` as an unquoted,
 * comma-separated scalar (`globs: *.py`); a YAML list is accepted on import too,
 * and an empty `globs:` line parses as `null`.
 */
const TraeRuleFrontmatterSchema = z.looseObject({
  // `scene: git_message` also applies the rule to AI-generated commit messages.
  scene: z.optional(z.nullable(z.string())),
  description: z.optional(z.nullable(z.string())),
  globs: z.optional(z.nullable(z.union([z.string(), z.array(z.string())]))),
  alwaysApply: z.optional(z.nullable(z.boolean())),
});

export type TraeRuleFrontmatter = z.infer<typeof TraeRuleFrontmatterSchema>;

/** The frontmatter rulesync writes: Cursor's triple, `globs` joined with commas. */
type TraeRuleOutputFrontmatter = {
  scene?: string;
  alwaysApply?: boolean;
  description?: string;
  globs?: string;
};

/**
 * An unquoted `globs:` value to quote before YAML parsing. YAML's null and
 * boolean keywords and block scalar indicators (`|`, `>`) are left for YAML to
 * read, so `globs: null` stays null and `globs: |-` stays a block scalar.
 */
const UNQUOTED_GLOBS_LINE_REGEX =
  /^globs:[ \t]*(?!(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE)[ \t]*(?:#[^\r\n]*)?$)(?![|>])([^\s"'[][^\r\n]*?)[ \t]*$/m;

/** Globs that match every file, and so add nothing to an always-applied rule. */
const UNIVERSAL_GLOBS = new Set(["**/*", "*"]);

export type TraeRuleParams = {
  frontmatter: TraeRuleFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export type TraeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

function normalizeGlobs(globs: string | string[] | null | undefined): string[] {
  if (globs === null || globs === undefined) {
    return [];
  }
  const list = typeof globs === "string" ? splitBraceAwareList(globs) : globs;
  return list.map((glob) => glob.trim()).filter((glob) => glob.length > 0);
}

/**
 * Rule generator for Trae (ByteDance's AI IDE, "TraeCode" in its docs).
 *
 * Trae reads project rules from `.trae/rules/*.md` (recursively, up to three
 * levels of subfolders), each with optional Cursor-style frontmatter that
 * selects one of four application modes:
 *
 * - Always apply: `alwaysApply: true`.
 * - Specific files: `alwaysApply: false` plus `globs`.
 * - Apply intelligently: `alwaysApply: false` plus `description`.
 * - Apply manually (`#Rule` in chat): `alwaysApply: false` alone.
 *
 * There is no root rule file, so every rule (the `root: true` one included)
 * becomes a file under `.trae/rules/`, the same layout as Cursor. Global rules
 * (`~/.trae/user_rules`) are not supported: the docs do not say whether that
 * path is a file or a directory, nor what format its content takes.
 *
 * @see https://docs.trae.ai/ide/rules?_lang=en
 */
export class TraeRule extends ToolRule {
  private readonly frontmatter: TraeRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths(
    options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): TraeRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(TRAE_DIR, "rules", options.excludeToolDir),
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: TraeRuleParams) {
    if (rest.validate) {
      const result = TraeRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: TraeRule.stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  /**
   * Writes Cursor's frontmatter serialization (unquoted, comma-separated
   * `globs`), with Trae's `scene` line added when set.
   */
  private static stringifyFrontmatter(body: string, frontmatter: TraeRuleFrontmatter): string {
    const content = CursorRule.stringifyCursorFrontmatter(body, {
      alwaysApply: frontmatter.alwaysApply ?? undefined,
      description: frontmatter.description ?? undefined,
      globs:
        typeof frontmatter.globs === "string"
          ? frontmatter.globs
          : Array.isArray(frontmatter.globs) && frontmatter.globs.length > 0
            ? frontmatter.globs.join(",")
            : undefined,
    });
    // Flattened to one line, like Cursor's description, so it stays a plain scalar.
    const scene =
      typeof frontmatter.scene === "string"
        ? frontmatter.scene.replace(/[\r\n\u0085\u2028\u2029]+/g, " ").trim()
        : "";
    if (scene === "") {
      return content;
    }
    // A replacer function, so `$&` / `$'` in the value are not expanded as
    // replacement patterns that could close the frontmatter early.
    const sceneLine = dump({ scene }, { lineWidth: -1 }).trimEnd();
    return content.replace(/^---\n/, () => `---\n${sceneLine}\n`);
  }

  /**
   * Derives Trae's frontmatter from the canonical one. An explicit
   * `trae.alwaysApply` wins; otherwise specific `globs` make a file-scoped
   * rule, a `description` on a rule with no `globs` makes an intelligently
   * applied one, and everything else (the root rule, universal globs, bare
   * rules) is always applied, mirroring the AI Assistant mapping.
   */
  private static buildFrontmatter(frontmatter: RulesyncRuleFrontmatter): TraeRuleOutputFrontmatter {
    // Trae splits `globs` on every comma, so a brace alternation such as
    // `*.{ts,tsx}` is expanded into one glob per branch before it is joined.
    const globs = normalizeGlobs(frontmatter.globs).flatMap((glob) =>
      expandBraceAlternations(glob),
    );
    const specificGlobs = globs.filter((glob) => !UNIVERSAL_GLOBS.has(glob));
    const isRoot = frontmatter.root === true;
    const description = frontmatter.description?.trim() || undefined;

    const isFileScoped = specificGlobs.length > 0 && specificGlobs.length === globs.length;
    const isIntelligent = globs.length === 0 && description !== undefined;
    const derivedAlwaysApply = isRoot || !(isFileScoped || isIntelligent);
    const explicitAlwaysApply = frontmatter.trae?.alwaysApply;
    const alwaysApply = explicitAlwaysApply ?? derivedAlwaysApply;
    const scene = frontmatter.trae?.scene;
    // A rule that is not always applied needs every glob, universal ones
    // included, or it silently becomes a manual rule. An always-applied rule
    // drops the globs (Cursor's staff call the pair a semantic conflict),
    // except the specific ones an explicit `trae.alwaysApply: true` keeps.
    const outputGlobs = !alwaysApply ? globs : explicitAlwaysApply === true ? specificGlobs : [];

    return {
      ...(scene !== undefined && { scene }),
      alwaysApply,
      ...(description !== undefined && { description }),
      ...(outputGlobs.length > 0 && { globs: outputGlobs.join(",") }),
    };
  }

  /**
   * Parses the frontmatter the way Trae's editor writes it: `globs` is an
   * unquoted, comma-separated scalar, which a YAML parser rejects or misreads
   * when it starts with `*`, `{`, `!` and the like. Such a value is quoted
   * before parsing, inside the frontmatter block only so the body is never
   * rewritten. A quoted value, a YAML list, a null or boolean keyword and a
   * block scalar indicator (`|`, `>`) are left alone. The block bounds are
   * gray-matter's own (it closes the block at the first `\n---`, even inside a
   * `----` line), so the quoting never reaches text gray-matter reads as body.
   */
  private static parseTraeFrontmatter(
    fileContent: string,
    filePath: string,
  ): { frontmatter: Record<string, unknown>; body: string } {
    const bounds = findFrontmatterBlockBounds(fileContent);
    if (!bounds) {
      return parseFrontmatter(fileContent, filePath);
    }
    const { blockStart: start, blockEnd: end } = bounds;
    const block = fileContent
      .slice(start, end)
      .replace(UNQUOTED_GLOBS_LINE_REGEX, (_match, value: string) => {
        return `globs: ${JSON.stringify(value)}`;
      });
    return parseFrontmatter(fileContent.slice(0, start) + block + fileContent.slice(end), filePath);
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): TraeRule {
    const frontmatter = this.buildFrontmatter(rulesyncRule.getFrontmatter());
    // A glob past the expansion cap, or one with a literal comma, still holds a
    // comma that Trae reads as a separator.
    const commaGlobs = normalizeGlobs(rulesyncRule.getFrontmatter().globs)
      .flatMap((glob) => expandBraceAlternations(glob))
      .filter((glob) => glob.includes(","));
    if (frontmatter.globs !== undefined && commaGlobs.length > 0) {
      warnWithFallback(
        undefined,
        `${rulesyncRule.getRelativeFilePath()}: Trae splits globs on every comma, so ${commaGlobs.map((glob) => `"${glob}"`).join(", ")} will not match as written.`,
      );
    }
    return new TraeRule({
      outputRoot,
      frontmatter,
      body: rulesyncRule.getBody(),
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      validate,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const sourceGlobs = normalizeGlobs(this.frontmatter.globs);
    const alwaysApply = this.frontmatter.alwaysApply ?? undefined;
    const description = this.frontmatter.description?.trim() || undefined;
    // `alwaysApply: true` with no globs is "every file" for the tools that
    // know nothing about `alwaysApply`.
    const globs = sourceGlobs.length === 0 && alwaysApply === true ? ["**/*"] : sourceGlobs;

    const frontmatter: RulesyncRuleFrontmatter = {
      targets: ["*"],
      root: false,
      description,
      globs,
    };
    // `trae.alwaysApply` is carried only when the next generate would not
    // derive the same value from `globs` / `description` (e.g. a manual rule).
    const derived = TraeRule.buildFrontmatter(frontmatter).alwaysApply;
    const needsOverride = alwaysApply !== undefined && alwaysApply !== derived;
    const scene = this.frontmatter.scene ?? undefined;
    const trae = {
      ...(needsOverride && { alwaysApply }),
      ...(scene !== undefined && { scene }),
    };

    return new RulesyncRule({
      frontmatter: {
        ...frontmatter,
        ...(Object.keys(trae).length > 0 && { trae }),
      },
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<TraeRule> {
    const relativeDirPath = this.getSettablePaths().nonRoot.relativeDirPath;
    const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = TraeRule.parseTraeFrontmatter(fileContent, filePath);

    const result = TraeRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new TraeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): TraeRule {
    return new TraeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = TraeRuleFrontmatterSchema.safeParse(this.frontmatter);
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

  getFrontmatter(): TraeRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "trae",
    });
  }
}
