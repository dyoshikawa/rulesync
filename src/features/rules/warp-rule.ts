import { join } from "node:path";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  buildToolPath,
} from "./tool-rule.js";

export type WarpRuleParams = AiFileParams & {
  root?: boolean;
};

export type WarpRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export class WarpRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: WarpRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): WarpRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".warp", "memories", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<WarpRule> {
    const isRoot = relativeFilePath === this.getSettablePaths().root.relativeFilePath;
    const relativePath = isRoot
      ? this.getSettablePaths().root.relativeFilePath
      : join(this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new WarpRule({
      outputRoot,
      relativeDirPath: isRoot ? this.getSettablePaths().root.relativeDirPath : ".warp",
      relativeFilePath: isRoot ? this.getSettablePaths().root.relativeFilePath : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): WarpRule {
    return new WarpRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
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

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): WarpRule {
    const isRoot = relativeFilePath === this.getSettablePaths().root.relativeFilePath;

    return new WarpRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "warp",
    });
  }
}
