import { join } from "node:path";

import { GOOSE_GLOBAL_DIR, GOOSE_RULE_FILE_NAME } from "../../constants/goose-paths.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";

export type GooseRuleParams = ToolRuleParams;

export type GooseRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export type GooseRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Represents a rule file for Goose.
 *
 * Goose loads instruction context only from the `.goosehints` / `AGENTS.md`
 * family (the configured `CONTEXT_FILE_NAMES`), discovered by walking from the
 * working directory up to the repository root plus any nested directories Goose
 * touches during a session. The separate `.goose/memories/` tree is the Memory
 * extension's storage and is NOT auto-loaded as session context.
 * (Verified against the official docs:
 * https://block.github.io/goose/docs/guides/context-engineering/using-goosehints/)
 *
 * rulesync's topic-based non-root rules have no project subdirectory to map onto,
 * so writing them under `.goose/memories/` made them effectively invisible to
 * Goose. Their bodies are instead folded into the single root `.goosehints` by
 * the RulesProcessor (there is no separate non-root output location — `nonRoot`
 * is `undefined`). This mirrors the grokcli, warp, and deepagents targets.
 *
 * Goose uses plain markdown files (.goosehints) without frontmatter.
 */
export class GooseRule extends ToolRule {
  static getSettablePaths({
    global,
  }: {
    global?: boolean;
  } = {}): GooseRuleSettablePaths | GooseRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: GOOSE_GLOBAL_DIR,
          relativeFilePath: GOOSE_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: GOOSE_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<GooseRule> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
    );

    return new GooseRule({
      outputRoot,
      relativeDirPath: paths.root.relativeDirPath,
      relativeFilePath: paths.root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): GooseRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new GooseRule({
      outputRoot,
      relativeDirPath: paths.root.relativeDirPath,
      relativeFilePath: paths.root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: isRoot,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate() {
    // Goose uses plain markdown without frontmatter requirements
    // Validation always succeeds
    return { success: true as const, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): GooseRule {
    const paths = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      (relativeDirPath === "." || relativeDirPath === paths.root.relativeDirPath);

    return new GooseRule({
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
      toolTarget: "goose",
    });
  }
}
