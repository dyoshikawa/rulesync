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

export type FactorydroidRuleParams = AiFileParams & {
  root?: boolean;
};

export type FactorydroidRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export class FactorydroidRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: FactorydroidRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths(options?: { global?: boolean }): FactorydroidRuleSettablePaths {
    if (options?.global) {
      return {
        root: {
          relativeDirPath: ".factorydroid",
          relativeFilePath: "AGENTS.md",
        },
        nonRoot: {
          relativeDirPath: join(".factorydroid", "memories"),
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".factorydroid",
        relativeFilePath: "AGENTS.md",
      },
      nonRoot: {
        relativeDirPath: join(".factorydroid", "memories"),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<FactorydroidRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    const relativePath = isRoot
      ? join(paths.root.relativeDirPath, "AGENTS.md")
      : join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new FactorydroidRule({
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
  }: ToolRuleForDeletionParams): FactorydroidRule {
    const paths = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === "AGENTS.md" && relativeDirPath === paths.root.relativeDirPath;

    return new FactorydroidRule({
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
  }: ToolRuleFromRulesyncRuleParams): FactorydroidRule {
    const paths = this.getSettablePaths({ global });
    return new FactorydroidRule(
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
      toolTarget: "factorydroid",
    });
  }
}
