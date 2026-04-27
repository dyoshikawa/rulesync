import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  type ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type KiloRuleParams = ToolRuleParams;

export type KiloRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export type KiloRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

export class KiloRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): KiloRuleSettablePaths | KiloRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".config/kilo", ".", excludeToolDir),
          relativeFilePath: "AGENTS.md",
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".kilo", "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<KiloRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const relativePath = paths.root.relativeFilePath;
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, relativePath),
      );

      return new KiloRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));
    return new KiloRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): KiloRule {
    const paths = this.getSettablePaths({ global });
    return new KiloRule(
      this.buildToolRuleParamsAgentsmd({
        outputRoot,
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
    // Kilo rules are always valid since they use plain markdown format
    // Similar to AgentsMdRule, no complex frontmatter validation needed
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): KiloRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new KiloRule({
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
      toolTarget: "kilo",
    });
  }
}
