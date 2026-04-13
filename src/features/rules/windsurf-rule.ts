import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
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

export type WindsurfRuleParams = ToolRuleParams;
type WindsurfRuleFrontmatter = {
  title: string;
  trigger: "always_on" | "glob";
  globs?: string[];
};

export type WindsurfRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};
export class WindsurfRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): WindsurfRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".windsurf", "rules", _options.excludeToolDir),
      },
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
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
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    const toolRuleParams = this.buildToolRuleParamsDefault({
      baseDir,
      rulesyncRule,
      validate,
      nonRootPath: this.getSettablePaths().nonRoot,
    });

    const windsurfFrontmatter = this.buildWindsurfFrontmatter({
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      description: rulesyncRule.getFrontmatter().description,
      globs: rulesyncRule.getFrontmatter().globs,
    });

    return new WindsurfRule({
      ...toolRuleParams,
      fileContent: stringifyFrontmatter(rulesyncRule.getBody(), windsurfFrontmatter),
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): WindsurfRule {
    return new WindsurfRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "windsurf",
    });
  }

  private static buildWindsurfFrontmatter({
    relativeFilePath,
    description,
    globs,
  }: {
    relativeFilePath: string;
    description: string | undefined;
    globs: string[] | undefined;
  }): WindsurfRuleFrontmatter {
    const hasSpecificGlobs = Boolean(globs && globs.length > 0 && !globs.includes("**/*"));

    return {
      title: description ?? relativeFilePath.replace(/\.md$/, ""),
      trigger: hasSpecificGlobs ? "glob" : "always_on",
      ...(hasSpecificGlobs && { globs }),
    };
  }
}
