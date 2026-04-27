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

export type DeepagentsRuleParams = AiFileParams & {
  root?: boolean;
};

export type DeepagentsRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export class DeepagentsRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: DeepagentsRuleParams) {
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
  ): DeepagentsRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".deepagents",
        relativeFilePath: "AGENTS.md",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".deepagents", "memories", _options.excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<DeepagentsRule> {
    const settablePaths = this.getSettablePaths();
    const isRoot = relativeFilePath === "AGENTS.md";
    const relativePath = isRoot
      ? join(".deepagents", "AGENTS.md")
      : join(".deepagents", "memories", relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new DeepagentsRule({
      outputRoot,
      relativeDirPath: isRoot
        ? settablePaths.root.relativeDirPath
        : settablePaths.nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "AGENTS.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): DeepagentsRule {
    const isRoot = relativeFilePath === "AGENTS.md" && relativeDirPath === ".deepagents";

    return new DeepagentsRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): DeepagentsRule {
    return new DeepagentsRule(
      this.buildToolRuleParamsAgentsmd({
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

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "deepagents",
    });
  }
}
