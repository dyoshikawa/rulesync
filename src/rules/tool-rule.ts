import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFileParams, AiFileParams } from "../types/ai-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { RulesyncRule } from "./rulesync-rule.js";

export type ToolRuleParams = AiFileParams & {
  root?: boolean | undefined;
  description?: string | undefined;
};

export type ToolRuleFromRulesyncRuleParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncRule: RulesyncRule;
};

export type ToolRuleFromFileParams = AiFileFromFileParams;

export type ToolRuleSettablePaths = {
  root?: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export abstract class ToolRule extends ToolFile {
  protected readonly root: boolean;
  protected readonly description?: string | undefined;

  constructor({ root = false, description, ...rest }: ToolRuleParams) {
    super(rest);
    this.root = root;
    this.description = description;
  }

  static async fromFile(_params: ToolRuleFromFileParams): Promise<ToolRule> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncRule(_params: ToolRuleFromRulesyncRuleParams): ToolRule {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static buildToolRuleParamsDefault({
    baseDir = ".",
    rulesyncRule,
    validate = true,
    rootPath = { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
    nonRootPath = { relativeDirPath: ".agents/memories" },
  }: ToolRuleFromRulesyncRuleParams & {
    rootPath?: {
      relativeDirPath: string;
      relativeFilePath: string;
    };
    nonRootPath?: {
      relativeDirPath: string;
    };
  }): Omit<ToolRuleParams, "root"> & {
    root: boolean;
  } {
    const fileContent = rulesyncRule.getBody();

    return {
      baseDir,
      relativeDirPath: rulesyncRule.getFrontmatter().root
        ? rootPath.relativeDirPath
        : nonRootPath.relativeDirPath,
      relativeFilePath: rulesyncRule.getFrontmatter().root
        ? rootPath.relativeFilePath
        : rulesyncRule.getRelativeFilePath(),
      fileContent,
      validate,
      root: rulesyncRule.getFrontmatter().root ?? false,
      description: rulesyncRule.getFrontmatter().description,
    };
  }

  abstract toRulesyncRule(): RulesyncRule;

  protected toRulesyncRuleDefault(): RulesyncRule {
    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: this.isRoot(),
        targets: ["*"],
        description: this.description,
        globs: this.isRoot() ? ["**/*"] : [],
      },
      body: this.getFileContent(),
    });
  }

  isRoot(): boolean {
    return this.root;
  }

  getDescription(): string | undefined {
    return this.description;
  }

  static isTargetedByRulesyncRule(_rulesyncRule: RulesyncRule): boolean {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static isTargetedByRulesyncRuleDefault({
    rulesyncRule,
    toolTarget,
  }: {
    rulesyncRule: RulesyncRule;
    toolTarget: ToolTarget;
  }): boolean {
    const targets = rulesyncRule.getFrontmatter().targets;
    if (!targets) {
      return true;
    }

    if (targets.includes("*")) {
      return true;
    }

    if (targets.includes(toolTarget)) {
      return true;
    }

    return false;
  }
}
