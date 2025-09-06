import { join } from "node:path";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
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

  static getSettablePaths(): AugmentcodeRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: ".augment/rules",
      },
    };
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AugmentcodeRule {
    return new AugmentcodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AugmentcodeRule> {
    const fileContent = await readFileContent(
      join(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath),
    );
    const { body: content } = parseFrontmatter(fileContent);

    return new AugmentcodeRule({
      baseDir: baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent: content.trim(),
      validate,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
