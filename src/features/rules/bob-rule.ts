import { join } from "node:path";

import { BOB_DIR, BOB_RULE_FILE_NAME } from "../../constants/bob-paths.js";
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

export type BobRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule generator for IBM Bob (Bob IDE and Bob Shell).
 *
 * Bob auto-loads plain-markdown instruction files with no frontmatter:
 *
 * - Project scope: the cross-tool `AGENTS.md` at the project root plus every
 *   `.bob/rules/*.md` file (read recursively in alphabetical order).
 * - Global scope: `~/.bob/AGENTS.md` plus `~/.bob/rules/*.md`.
 *
 * The workspace files override the user files. Bob's mode-specific
 * `.bob/rules-{mode}/` directories are left alone: rulesync has no notion of
 * Bob's modes, and a rule that should apply everywhere belongs in `.bob/rules/`.
 *
 * @see https://bob.ibm.com/docs/ide/configuration/rules
 * @see https://bob.ibm.com/docs/shell/configuration/configuring (user-scoped `~/.bob/AGENTS.md`)
 */
export class BobRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): BobRuleSettablePaths {
    return {
      root: {
        // The workspace file sits at the project root; the user file sits
        // inside `~/.bob/`, which the processor reaches by supplying the home
        // directory as outputRoot.
        relativeDirPath: global ? buildToolPath(BOB_DIR, ".", excludeToolDir) : ".",
        relativeFilePath: BOB_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(BOB_DIR, "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<BobRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );

      return new BobRule({
        outputRoot,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    const fileContent = await readFileContent(
      join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath),
    );
    return new BobRule({
      outputRoot,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
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
  }: ToolRuleFromRulesyncRuleParams): BobRule {
    const paths = this.getSettablePaths({ global });
    return new BobRule(
      this.buildToolRuleParamsDefault({
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

  validate() {
    // Bob rule files are plain markdown without frontmatter requirements.
    return { success: true as const, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): BobRule {
    const paths = this.getSettablePaths({ global });
    // A non-root rule may itself be named `AGENTS.md`; only the file outside
    // the rules directory is the root one.
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      relativeDirPath !== paths.nonRoot.relativeDirPath;

    return new BobRule({
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
      toolTarget: "bob",
    });
  }
}
