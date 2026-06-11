import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type KiroRuleParams = ToolRuleParams;

export type KiroRuleSettablePaths = Pick<ToolRuleSettablePaths, "nonRoot">;

/**
 * Steering `inclusion` frontmatter that Kiro reads at the top of each
 * `.kiro/steering/*.md` file:
 * - `always` — loaded into every interaction (Kiro's default when no frontmatter
 *   is present, so rulesync omits the block in this case).
 * - `fileMatch` — loaded only when the open file matches `fileMatchPattern`.
 * - `manual` — loaded on demand via `#steering-file-name`.
 *
 * @see https://kiro.dev/docs/steering/
 */
export type KiroSteeringInclusion = {
  inclusion: string;
  fileMatchPattern?: string;
};

const WILDCARD_GLOBS = new Set(["**/*", "**", "*"]);

/**
 * Derives the Kiro steering `inclusion` frontmatter for a non-root rule from the
 * rulesync rule frontmatter.
 *
 * Precedence:
 * 1. An explicit `kiro.inclusion` block round-trips as-is (with `fileMatchPattern`
 *    taken from the block, or derived from `globs` when omitted for `fileMatch`).
 * 2. Otherwise specific (non-wildcard) globs map to `fileMatch`, scoping the rule
 *    to matching files instead of leaving it implicitly always-on.
 * 3. Otherwise the rule stays `always` — represented by omitting the block so the
 *    emitted file matches Kiro's no-frontmatter default.
 *
 * Returns `undefined` when no frontmatter should be written (the `always` case).
 */
export function deriveKiroInclusion({
  kiro,
  globs,
}: {
  kiro?: { inclusion?: string; fileMatchPattern?: string };
  globs?: string[];
}): KiroSteeringInclusion | undefined {
  const specificGlobs = (globs ?? []).filter((g) => !WILDCARD_GLOBS.has(g));

  if (kiro?.inclusion) {
    if (kiro.inclusion === "fileMatch") {
      const fileMatchPattern = kiro.fileMatchPattern ?? (specificGlobs.join(",") || undefined);
      return fileMatchPattern
        ? { inclusion: "fileMatch", fileMatchPattern }
        : { inclusion: "fileMatch" };
    }
    return { inclusion: kiro.inclusion };
  }

  if (specificGlobs.length > 0) {
    return { inclusion: "fileMatch", fileMatchPattern: specificGlobs.join(",") };
  }

  return undefined;
}

/**
 * Rule generator for Kiro AI-powered IDE
 *
 * Generates steering documents for Kiro's spec-driven development approach in the
 * `.kiro/steering/` directory (product.md, structure.md, tech.md, ...).
 *
 * Non-root steering files carry an `inclusion` frontmatter block derived from the
 * rulesync rule's globs / `kiro` override (see {@link deriveKiroInclusion}); the
 * root overview index stays plain so Kiro always loads it.
 */
export class KiroRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): KiroRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".kiro", "steering", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<KiroRule> {
    const relativeDirPath = this.getSettablePaths().nonRoot.relativeDirPath;
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new KiroRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): KiroRule {
    const params = this.buildToolRuleParamsDefault({
      outputRoot,
      rulesyncRule,
      validate,
      nonRootPath: this.getSettablePaths().nonRoot,
    });

    // The root overview index stays plain (Kiro always-loads a frontmatter-less
    // steering file). Only non-root steering files carry inclusion frontmatter.
    if (params.root) {
      return new KiroRule(params);
    }

    const frontmatter = rulesyncRule.getFrontmatter();
    const inclusion = deriveKiroInclusion({
      kiro: frontmatter.kiro,
      globs: frontmatter.globs,
    });

    if (!inclusion) {
      return new KiroRule(params);
    }

    return new KiroRule({
      ...params,
      fileContent: stringifyFrontmatter(rulesyncRule.getBody(), inclusion),
    });
  }

  toRulesyncRule(): RulesyncRule {
    // Round-trip steering inclusion frontmatter back into the rulesync `kiro`
    // block (plus `globs` for fileMatch), so re-generating reproduces the file.
    const { frontmatter, body } = parseFrontmatter(
      this.getFileContent(),
      this.getRelativeFilePath(),
    );
    const inclusion = typeof frontmatter.inclusion === "string" ? frontmatter.inclusion : undefined;

    if (!inclusion) {
      return this.toRulesyncRuleDefault();
    }

    const fileMatchPattern =
      typeof frontmatter.fileMatchPattern === "string" ? frontmatter.fileMatchPattern : undefined;
    const globs =
      inclusion === "fileMatch" && fileMatchPattern
        ? fileMatchPattern.split(",").map((g) => g.trim())
        : [];

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        globs,
        kiro: { inclusion, ...(fileMatchPattern ? { fileMatchPattern } : {}) },
      },
      body,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): KiroRule {
    return new KiroRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kiro",
    });
  }
}
