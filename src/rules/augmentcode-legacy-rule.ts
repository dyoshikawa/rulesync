import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type AugmentcodeLegacyRuleParams = ToolRuleParams;

export type AugmentcodeLegacyRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export class AugmentcodeLegacyRule extends ToolRule {
  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      root: this.isRoot(),
      targets: ["*"],
      description: "",
      globs: this.isRoot() ? ["**/*"] : [],
    };

    return new RulesyncRule({
      baseDir: ".", // RulesyncRule baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: join(".rulesync", "rules"),
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static getSettablePaths(): AugmentcodeLegacyRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
      },
      nonRoot: {
        relativeDirPath: join(".augment", "rules"),
      },
    };
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    return new AugmentcodeLegacyRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "augmentcode-legacy",
    });
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AugmentcodeLegacyRule> {
    const settablePaths = this.getSettablePaths();
    // Determine if it's a root file
    const isRoot = relativeFilePath === settablePaths.root.relativeFilePath;
    const relativePath = isRoot
      ? settablePaths.root.relativeFilePath
      : join(settablePaths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new AugmentcodeLegacyRule({
      baseDir: baseDir,
      relativeDirPath: isRoot
        ? settablePaths.root.relativeDirPath
        : settablePaths.nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? settablePaths.root.relativeFilePath : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }
}
