import { join } from "node:path";
import { AiFileFromFileParams, AiFileParams } from "../types/ai-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { RulesyncRule } from "./rulesync-rule.js";

export type ToolRuleParams = AiFileParams & {
  root?: boolean | undefined;
  description?: string | undefined;
  globs?: string[] | undefined;
};

export type ToolRuleFromRulesyncRuleParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncRule: RulesyncRule;
  global?: boolean;
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

type BuildToolRuleParamsParams = ToolRuleFromRulesyncRuleParams & {
  rootPath?: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRootPath?: {
    relativeDirPath: string;
  };
};

type BuildToolRuleParamsResult = Omit<ToolRuleParams, "root"> & {
  root: boolean;
};

type getSettablePathsParams = {
  global: boolean;
};

export abstract class ToolRule extends ToolFile {
  protected readonly root: boolean;
  protected readonly description?: string | undefined;
  protected readonly globs?: string[] | undefined;

  constructor({ root = false, description, globs, ...rest }: ToolRuleParams) {
    super(rest);
    this.root = root;
    this.description = description;
    this.globs = globs;
  }

  static getSettablePaths(_params: getSettablePathsParams): ToolRuleSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  static async fromFile(_params: ToolRuleFromFileParams | undefined): Promise<ToolRule> {
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
  }: BuildToolRuleParamsParams): BuildToolRuleParamsResult {
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
      globs: rulesyncRule.getFrontmatter().globs,
    };
  }

  protected static buildToolRuleParamsAgentsmd({
    baseDir = ".",
    rulesyncRule,
    validate = true,
    rootPath = { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
    nonRootPath = { relativeDirPath: ".agents/memories" },
  }: BuildToolRuleParamsParams): BuildToolRuleParamsResult {
    const params = this.buildToolRuleParamsDefault({
      baseDir,
      rulesyncRule,
      validate,
      rootPath,
      nonRootPath,
    });

    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    if (!rulesyncFrontmatter.root && rulesyncFrontmatter.agentsmd?.subprojectPath) {
      params.relativeDirPath = join(rulesyncFrontmatter.agentsmd.subprojectPath);
      params.relativeFilePath = "AGENTS.md";
    }

    return params;
  }

  abstract toRulesyncRule(): RulesyncRule;

  protected toRulesyncRuleDefault(): RulesyncRule {
    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: this.isRoot(),
        targets: ["*"],
        description: this.description ?? "",
        globs: this.globs ?? (this.isRoot() ? ["**/*"] : []),
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

  getGlobs(): string[] | undefined {
    return this.globs;
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
