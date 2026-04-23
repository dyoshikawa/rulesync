import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type PiRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export type PiRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for Pi Coding Agent.
 *
 * Pi uses a single `AGENTS.md` file at the project root for the overview,
 * plus optional `.agents/memories/*.md` files referenced from the root via
 * TOON format (`ruleDiscoveryMode: "toon"`).
 *
 * In global mode, only the root `~/.pi/agent/AGENTS.md` is emitted; non-root
 * rules are not supported.
 */
export class PiRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): PiRuleSettablePaths | PiRuleSettablePathsGlobal {
    if (global) {
      // When excludeToolDir is true the caller drops the `.pi` prefix and only
      // the `agent` directory remains (e.g. when emitting into a pre-scoped
      // global directory). Pi has no non-root memories in global mode, so we
      // return only the root path entry.
      return {
        root: {
          relativeDirPath: buildToolPath(".pi", "agent", excludeToolDir),
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
        relativeDirPath: buildToolPath(".agents", "memories", excludeToolDir),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<PiRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const fileContent = await readFileContent(
        join(baseDir, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );

      return new PiRule({
        baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(
        `PiRule does not support non-root rules in global mode; expected '${paths.root.relativeFilePath}' but got '${relativeFilePath}'`,
      );
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));
    return new PiRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): PiRule {
    const paths = this.getSettablePaths({ global });
    return new PiRule(
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
    // Pi rules are plain markdown files without complex frontmatter,
    // so any body content is considered valid.
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): PiRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new PiRule({
      baseDir,
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
      toolTarget: "pi",
    });
  }
}
