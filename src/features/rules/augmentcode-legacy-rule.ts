import { join } from "node:path";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
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
      globs: this.isRoot() ? ["**/*"] : [],
    };

    return new RulesyncRule({
      outputRoot: ".", // RulesyncRule outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): AugmentcodeLegacyRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".augment", "rules", _options.excludeToolDir),
      },
    };
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    return new AugmentcodeLegacyRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
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
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AugmentcodeLegacyRule> {
    const settablePaths = this.getSettablePaths();
    // Determine if it's a root file
    const isRoot = relativeFilePath === settablePaths.root.relativeFilePath;
    const relativePath = isRoot
      ? settablePaths.root.relativeFilePath
      : join(settablePaths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new AugmentcodeLegacyRule({
      outputRoot: outputRoot,
      relativeDirPath: isRoot
        ? settablePaths.root.relativeDirPath
        : settablePaths.nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? settablePaths.root.relativeFilePath : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): AugmentcodeLegacyRule {
    const settablePaths = this.getSettablePaths();
    const isRoot = relativeFilePath === settablePaths.root.relativeFilePath;

    return new AugmentcodeLegacyRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }
}
