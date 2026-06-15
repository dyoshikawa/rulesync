import { join } from "node:path";

import { z } from "zod/mini";

import { AUGMENTCODE_DIR } from "../../constants/augmentcode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
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

/**
 * Default rule type emitted when no explicit type is provided.
 * Matches Augment's documented default (https://docs.augmentcode.com/cli/rules).
 */
const DEFAULT_AUGMENTCODE_TYPE = "always_apply";

/**
 * Frontmatter schema for Augment Code workspace rules (`.augment/rules/*.md`).
 *
 * Augment supports YAML frontmatter with:
 * - `type`: one of always_apply | manual | agent_requested (default always_apply)
 * - `description`: required when type is agent_requested
 *
 * A loose object is used so unknown Augment fields pass through untouched.
 */
export const AugmentcodeRuleFrontmatterSchema = z.looseObject({
  type: z.optional(z.string()),
  description: z.optional(z.string()),
});

export type AugmentcodeRuleFrontmatter = z.infer<typeof AugmentcodeRuleFrontmatterSchema>;

/**
 * Parameters for creating an AugmentcodeRule instance.
 * Requires frontmatter and body separately instead of combined fileContent.
 */
export type AugmentcodeRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  frontmatter: AugmentcodeRuleFrontmatter;
  body: string;
};

export type AugmentcodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for Augment Code.
 *
 * Generates rule files for Augment's `.augment/rules/` directory and preserves
 * the `type` / `description` frontmatter so it round-trips through rulesync.
 *
 * - Project scope: `.augment/rules/*.md` with typed frontmatter.
 * - Global scope: `~/.augment/rules/*.md`. Augment forces user/global rules to
 *   `always_apply` and ignores typed frontmatter, so global rules are emitted as
 *   a plain body without frontmatter.
 */
export class AugmentcodeRule extends ToolRule {
  private readonly frontmatter: AugmentcodeRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: AugmentcodeRuleParams) {
    if (rest.validate !== false) {
      const result = AugmentcodeRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    // Emit frontmatter only when there is something to emit. Global rules pass an
    // empty frontmatter object and therefore produce a plain body.
    const hasFrontmatter = Object.keys(frontmatter).length > 0;
    const fileContent = hasFrontmatter ? stringifyFrontmatter(body, frontmatter) : body;

    super({
      ...rest,
      fileContent,
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): AugmentcodeRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(AUGMENTCODE_DIR, "rules", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<AugmentcodeRule> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    let parsedFrontmatter: AugmentcodeRuleFrontmatter;
    if (validate) {
      const result = AugmentcodeRuleFrontmatterSchema.safeParse(frontmatter);
      if (result.success) {
        parsedFrontmatter = result.data;
      } else {
        throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
      }
    } else {
      parsedFrontmatter = frontmatter as AugmentcodeRuleFrontmatter;
    }

    return new AugmentcodeRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      body: body.trim(),
      frontmatter: parsedFrontmatter,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): AugmentcodeRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const storedAugmentcode = rulesyncFrontmatter.augmentcode;
    const paths = this.getSettablePaths({ global });

    // Augment forces user/global rules to always_apply and ignores typed
    // frontmatter, so global rules are emitted as a plain body.
    if (global) {
      return new AugmentcodeRule({
        outputRoot,
        relativeDirPath: paths.nonRoot.relativeDirPath,
        relativeFilePath: rulesyncRule.getRelativeFilePath(),
        frontmatter: {},
        body: rulesyncRule.getBody(),
        validate,
        root: false,
      });
    }

    const { type: storedType, description: storedDescription, ...extra } = storedAugmentcode ?? {};
    const type = typeof storedType === "string" ? storedType : DEFAULT_AUGMENTCODE_TYPE;
    // Prefer the top-level rulesync description, fall back to augmentcode.description.
    const description = rulesyncFrontmatter.description ?? storedDescription;

    const frontmatter: AugmentcodeRuleFrontmatter = {
      ...extra,
      type,
      // agent_requested requires a description; keep whatever is available.
      ...(description !== undefined ? { description } : {}),
    };

    return new AugmentcodeRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const { type, description, ...extra } = this.frontmatter;

    const augmentcode = {
      ...extra,
      ...(type !== undefined ? { type } : {}),
      ...(description !== undefined ? { description } : {}),
    };

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        ...(description !== undefined ? { description } : {}),
        // Only attach the augmentcode block when it carries data; a global rule
        // imported with empty frontmatter would otherwise emit `augmentcode: {}`.
        ...(Object.keys(augmentcode).length > 0 ? { augmentcode } : {}),
      },
      body: this.body,
    });
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): AugmentcodeRuleFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    const result = AugmentcodeRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return { success: false, error: new Error(formatError(result.error)) };
    }
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): AugmentcodeRule {
    return new AugmentcodeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "augmentcode",
    });
  }
}
