import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type WindsurfRuleParams = ToolRuleParams;

export type WindsurfRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};
export class WindsurfRule extends ToolRule {
  static getSettablePaths(): WindsurfRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: ".windsurf/rules",
      },
    };
  }
  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<WindsurfRule> {
    const fileContent = await readFileContent(
      join(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath),
    );

    return new WindsurfRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    return new WindsurfRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
