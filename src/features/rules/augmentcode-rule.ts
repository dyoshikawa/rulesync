import { join } from "node:path";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type AugmentcodeRuleParams = AiFileParams;

export type AugmentcodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

export class AugmentcodeRule extends ToolRule {
  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): AugmentcodeRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".augment", "rules", _options.excludeToolDir),
      },
    };
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AugmentcodeRule {
    return new AugmentcodeRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AugmentcodeRule> {
    const filePath = join(
      outputRoot,
      this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent, filePath);

    return new AugmentcodeRule({
      outputRoot: outputRoot,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent: content.trim(),
      validate,
    });
  }

  validate(): ValidationResult {
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
      fileContent: "",
      validate: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "augmentcode",
    });
  }
}
