import { join } from "node:path";

import { z } from "zod/mini";

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

export const ClineRuleFrontmatterSchema = z.object({
  description: z.string(),
});

export type ClineRuleFrontmatter = z.infer<typeof ClineRuleFrontmatterSchema>;

export type ClineRuleSettablePaths = Pick<ToolRuleSettablePaths, "nonRoot">;

export type ClineRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for Cline.
 *
 * - Project scope: a flat `.clinerules/*.md` directory of rule files.
 * - Global scope: a single cross-tool `~/.agents/AGENTS.md` file. Cline reads
 *   global AGENTS rules from `~/.agents/AGENTS.md` (introduced in Cline CLI
 *   v3.0.15, 2026-05-29), following the agents.md standard, so global rules are
 *   applied across all sessions and projects.
 */
export class ClineRule extends ToolRule {
  static getSettablePaths({
    global = false,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ClineRuleSettablePaths | ClineRuleSettablePathsGlobal {
    if (global) {
      // Cline reads global agent rules from the cross-tool `~/.agents/AGENTS.md`
      // location (the agents.md standard), not a `.cline`-prefixed tool dir.
      return {
        root: {
          relativeDirPath: buildToolPath(".agents", ".", excludeToolDir),
          relativeFilePath: "AGENTS.md",
        },
      };
    }
    return {
      nonRoot: {
        // .clinerules is a flat directory, so excludeToolDir has no effect
        relativeDirPath: ".clinerules",
      },
    };
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    if (global) {
      const paths = this.getSettablePaths({ global: true });
      if (!("root" in paths)) {
        throw new Error("ClineRule global settable paths must include a root path");
      }
      if (!rulesyncRule.getFrontmatter().root) {
        throw new Error(
          `ClineRule does not support non-root rules in global mode; expected a root rule but got '${rulesyncRule.getRelativeFilePath()}'`,
        );
      }
      return new ClineRule(
        this.buildToolRuleParamsAgentsmd({
          outputRoot,
          rulesyncRule,
          validate,
          rootPath: paths.root,
        }),
      );
    }

    return new ClineRule(
      this.buildToolRuleParamsDefault({
        outputRoot,
        rulesyncRule,
        validate,
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
      toolTarget: "cline",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<ClineRule> {
    if (global) {
      const paths = this.getSettablePaths({ global: true });
      if (!("root" in paths)) {
        throw new Error("ClineRule global settable paths must include a root path");
      }
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );

      return new ClineRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    const paths = this.getSettablePaths();
    if (!paths.nonRoot) {
      throw new Error("ClineRule project settable paths must include a nonRoot path");
    }

    // Read file content
    const fileContent = await readFileContent(
      join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath),
    );

    return new ClineRule({
      outputRoot: outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): ClineRule {
    return new ClineRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: global,
    });
  }
}
