import { join } from "node:path";

import {
  ANTIGRAVITY_AGENTS_DIR,
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_GLOBAL_RULE_FILE_NAME,
  ANTIGRAVITY_RULE_FILE_NAME,
} from "../../constants/antigravity-cli-paths.js";
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

export type AntigravityCliRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export type AntigravityCliRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for the Google Antigravity CLI (`agy`, the Gemini-CLI
 * successor in Antigravity 2.0).
 *
 * The CLI reads the same plain-markdown context files as Gemini CLI — a root
 * context file plus non-root memory files in `.agents/rules/` — so this class
 * follows that same plain-markdown approach but points at the new `.agents/` tree.
 *
 * - Project scope: root `AGENTS.md` (the cross-tool standard, matching
 *   `antigravity-ide`); non-root `.agents/rules/*.md`.
 * - Global scope: a single plain `~/.gemini/GEMINI.md` (shared with the IDE).
 */
export class AntigravityCliRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): AntigravityCliRuleSettablePaths | AntigravityCliRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(ANTIGRAVITY_GEMINI_DIR, ".", excludeToolDir),
          relativeFilePath: ANTIGRAVITY_GLOBAL_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: ANTIGRAVITY_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(ANTIGRAVITY_AGENTS_DIR, "rules", excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<AntigravityCliRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const relativePath = paths.root.relativeFilePath;
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, relativePath),
      );

      return new AntigravityCliRule({
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
    return new AntigravityCliRule({
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
  }: ToolRuleFromRulesyncRuleParams): AntigravityCliRule {
    const paths = this.getSettablePaths({ global });
    return new AntigravityCliRule(
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
    // Antigravity CLI uses plain markdown without frontmatter requirements.
    return { success: true as const, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): AntigravityCliRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new AntigravityCliRule({
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
      toolTarget: "antigravity-cli",
    });
  }
}
