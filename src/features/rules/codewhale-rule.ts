import { join } from "node:path";

import {
  CODEWHALE_DIR,
  CODEWHALE_RULE_FILE_NAME,
  CODEWHALE_RULES_DIR_NAME,
} from "../../constants/codewhale-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  type ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type CodewhaleRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

/**
 * Rule generator for Codewhale.
 *
 * Project scope: the workspace-root `AGENTS.md` is Codewhale's canonical
 * project instruction file, and every `.codewhale/rules/*.md` file is loaded
 * after it as plain markdown in filename order, so non-root rules are written
 * there one file per rule. Codewhale does not walk into nested subproject
 * `AGENTS.md` files below the workspace, so `agentsmd.subprojectPath` is not
 * honored.
 *
 * Global scope: `~/.codewhale/AGENTS.md` is always loaded and prepended to the
 * project instructions. There is no user-scoped rules directory, so non-root
 * rules fold into that single file (`nonRoot` is undefined).
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/CONFIGURATION.md
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/project_context.rs
 */
export class CodewhaleRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): CodewhaleRuleSettablePaths | ToolRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(CODEWHALE_DIR, ".", excludeToolDir),
          relativeFilePath: CODEWHALE_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: CODEWHALE_RULE_FILE_NAME,
      },
      nonRoot: {
        relativeDirPath: buildToolPath(CODEWHALE_DIR, CODEWHALE_RULES_DIR_NAME, excludeToolDir),
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<CodewhaleRule> {
    const paths = this.getSettablePaths({ global });
    // A `.codewhale/rules/AGENTS.md` is an ordinary rule file, so the file name
    // alone does not identify the root; the directory must match too.
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      (relativeDirPath === undefined || relativeDirPath === paths.root.relativeDirPath);

    if (isRoot) {
      const fileContent = await readFileContent(
        join(outputRoot, paths.root.relativeDirPath, paths.root.relativeFilePath),
      );
      return new CodewhaleRule({
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

    const fileContent = await readFileContent(
      join(outputRoot, paths.nonRoot.relativeDirPath, relativeFilePath),
    );
    return new CodewhaleRule({
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
  }: ToolRuleFromRulesyncRuleParams): CodewhaleRule {
    if (global) {
      // Every global rule targets the single `~/.codewhale/AGENTS.md`; the
      // RulesProcessor folds the non-root bodies into the root rule.
      const { root } = this.getSettablePaths({ global: true });
      const frontmatter = rulesyncRule.getFrontmatter();
      return new CodewhaleRule({
        outputRoot,
        relativeDirPath: root.relativeDirPath,
        relativeFilePath: root.relativeFilePath,
        fileContent: rulesyncRule.getBody(),
        validate,
        root: frontmatter.root ?? false,
        description: frontmatter.description,
        globs: frontmatter.globs,
      });
    }

    const paths = this.getSettablePaths({ global: false });
    return new CodewhaleRule(
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

  validate(): ValidationResult {
    // Codewhale rules are plain markdown without frontmatter.
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): CodewhaleRule {
    const paths = this.getSettablePaths({ global });
    const isRoot =
      relativeFilePath === paths.root.relativeFilePath &&
      relativeDirPath === paths.root.relativeDirPath;

    return new CodewhaleRule({
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
      toolTarget: "codewhale",
    });
  }
}
