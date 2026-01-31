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
} from "./tool-rule.js";

export type FactoryRuleParams = AiFileParams & {
  root?: boolean;
};

export type FactoryRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export class FactoryRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: FactoryRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths(options?: { global?: boolean }): FactoryRuleSettablePaths {
    if (options?.global) {
      return {
        root: {
          relativeDirPath: ".factory",
          relativeFilePath: "AGENTS.md",
        },
        nonRoot: {
          relativeDirPath: join(".factory", "memories"),
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".factory",
        relativeFilePath: "AGENTS.md",
      },
      nonRoot: {
        relativeDirPath: join(".factory", "memories"),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<FactoryRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === "AGENTS.md";
    const relativePath = isRoot
      ? join(paths.root.relativeDirPath, "AGENTS.md")
      : join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new FactoryRule({
      baseDir,
      relativeDirPath: isRoot
        ? this.getSettablePaths().root.relativeDirPath
        : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "AGENTS.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): FactoryRule {
    const paths = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === "AGENTS.md" && relativeDirPath === paths.root.relativeDirPath;

    return new FactoryRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): FactoryRule {
    const paths = this.getSettablePaths({ global });
    return new FactoryRule(
      this.buildToolRuleParamsAgentsmd({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot,
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
      toolTarget: "factory",
    });
  }
}
