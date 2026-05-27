import { join } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
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
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export const QoderRuleFrontmatterSchema = z.looseObject({
  trigger: z.optional(z.string()),
  alwaysApply: z.optional(z.boolean()),
  description: z.optional(z.string()),
  glob: z.optional(z.string()),
});

export type QoderRuleFrontmatter = z.infer<typeof QoderRuleFrontmatterSchema>;

export type QoderRuleParams = {
  frontmatter: QoderRuleFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export type QoderRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

export class QoderRule extends ToolRule {
  private readonly frontmatter: QoderRuleFrontmatter;
  private readonly body: string;

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): QoderRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".qoder", "rules", _options.excludeToolDir),
      },
    };
  }

  constructor({ frontmatter, body, ...rest }: QoderRuleParams) {
    if (rest.validate) {
      const result = QoderRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true }),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  toRulesyncRule(): RulesyncRule {
    const targets: RulesyncTargets = ["*"];

    const isAlways = this.frontmatter.alwaysApply === true;
    const hasGlob = this.frontmatter.glob && this.frontmatter.glob.trim() !== "";

    let globs: string[];
    if (hasGlob && this.frontmatter.glob) {
      globs = this.frontmatter.glob
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0);
    } else if (isAlways) {
      globs = ["**/*"];
    } else {
      globs = [];
    }

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs,
      qoder: {
        trigger: this.frontmatter.trigger,
        alwaysApply: this.frontmatter.alwaysApply,
        description: this.frontmatter.description,
        globs: globs.length > 0 ? globs : undefined,
      },
    };

    return new RulesyncRule({
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.relativeFilePath,
      validate: true,
    });
  }

  /**
   * Infer the best Qoder trigger mode from rulesync canonical frontmatter.
   *
   * Priority: explicit qoder section > cursor hints > common fields.
   *
   * Mapping:
   *   alwaysApply / catch-all globs  → trigger: always_on
   *   specific globs                 → trigger: glob
   *   description only               → trigger: model_decision
   *   fallback                        → trigger: manual
   */
  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): QoderRule {
    const fm = rulesyncRule.getFrontmatter();

    // If the qoder section already has an explicit trigger, honour it directly
    if (fm.qoder?.trigger) {
      const qoderFrontmatter: QoderRuleFrontmatter = {
        trigger: fm.qoder.trigger,
        ...(fm.qoder.alwaysApply !== undefined && { alwaysApply: fm.qoder.alwaysApply }),
        ...(fm.qoder.description !== undefined && { description: fm.qoder.description }),
        ...(fm.qoder.globs !== undefined && { glob: fm.qoder.globs.join(",") }),
      };

      return new QoderRule({
        outputRoot,
        frontmatter: qoderFrontmatter,
        body: rulesyncRule.getBody(),
        relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
        relativeFilePath: rulesyncRule.getRelativeFilePath(),
        validate,
      });
    }

    // Infer from common / cursor fields
    const alwaysApply = fm.qoder?.alwaysApply ?? fm.cursor?.alwaysApply;
    const globs = fm.qoder?.globs ?? fm.globs;
    const description = fm.qoder?.description ?? fm.description;

    const isCatchAll =
      globs != null && globs.length > 0 && globs.every((g) => g === "**/*" || g === "**");
    const hasSpecificGlobs = globs != null && globs.length > 0 && !isCatchAll;

    let qoderFrontmatter: QoderRuleFrontmatter;

    if (alwaysApply === true || isCatchAll) {
      qoderFrontmatter = { trigger: "always_on", alwaysApply: true };
    } else if (hasSpecificGlobs) {
      qoderFrontmatter = { trigger: "glob", glob: globs!.join(",") };
    } else if (description) {
      qoderFrontmatter = { trigger: "model_decision", description };
    } else {
      qoderFrontmatter = { trigger: "manual", alwaysApply: false };
    }

    return new QoderRule({
      outputRoot,
      frontmatter: qoderFrontmatter,
      body: rulesyncRule.getBody(),
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      validate,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<QoderRule> {
    const filePath = join(
      outputRoot,
      this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = QoderRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new QoderRule({
      outputRoot,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = QoderRuleFrontmatterSchema.safeParse(this.frontmatter);
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

  getFrontmatter(): QoderRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): QoderRule {
    return new QoderRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "qoder",
    });
  }
}
