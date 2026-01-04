import { basename, dirname, join } from "node:path";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type GooseRuleParams = ToolRuleParams;

export type GooseRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

export class GooseRule extends ToolRule {
  static getSettablePaths({ global }: { global?: boolean } = {}): GooseRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: global ? join(".config", "goose") : ".",
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global,
  }: ToolRuleFromFileParams): Promise<GooseRule> {
    const settablePaths = this.getSettablePaths({ global });
    const ruleDirname = dirname(relativeFilePath);
    const resolvedRelativeDirPath =
      ruleDirname === "."
        ? settablePaths.nonRoot.relativeDirPath
        : join(settablePaths.nonRoot.relativeDirPath, ruleDirname);
    const ruleFileName = basename(relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, resolvedRelativeDirPath, ruleFileName));

    return new GooseRule({
      baseDir,
      relativeDirPath: resolvedRelativeDirPath,
      relativeFilePath: ruleFileName,
      fileContent,
      validate,
      root: ruleDirname === "." && !global,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global,
  }: ToolRuleFromRulesyncRuleParams): GooseRule {
    const settablePaths = this.getSettablePaths({ global });
    const rulesyncFilePath = rulesyncRule.getRelativeFilePath();
    const directoryPath = dirname(rulesyncFilePath);
    const isRoot = rulesyncRule.getFrontmatter().root ?? directoryPath === ".";
    const targetDir =
      directoryPath === "."
        ? settablePaths.nonRoot.relativeDirPath
        : join(settablePaths.nonRoot.relativeDirPath, directoryPath);

    return new GooseRule({
      baseDir,
      relativeDirPath: targetDir,
      relativeFilePath: ".goosehints",
      fileContent: rulesyncRule.getBody(),
      validate,
      root: isRoot && !global,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const relativeFilePath =
      this.getRelativeDirPath() === "."
        ? "goosehints.md"
        : join(this.getRelativeDirPath(), "goosehints.md");

    return new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath,
      frontmatter: {
        root: this.isRoot(),
        targets: ["*"],
      },
      body: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): GooseRule {
    return new GooseRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: relativeDirPath === ".",
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "goose",
    });
  }
}
