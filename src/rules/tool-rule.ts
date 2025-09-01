import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, AiFileParams } from "../types/ai-file.js";
import { ToolFile } from "../types/tool-file.js";
import { RulesyncRule } from "./rulesync-rule.js";

export type ToolRuleParams = AiFileParams & {
  root?: boolean | undefined;
};

export type ToolRuleFromRulesyncRuleParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncRule: RulesyncRule;
};

export abstract class ToolRule extends ToolFile {
  protected readonly root: boolean;

  constructor({ root = false, ...rest }: ToolRuleParams) {
    super(rest);
    this.root = root;
  }

  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<ToolRule> {
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
        description: "",
        globs: this.isRoot() ? ["**/*"] : [],
      },
      body: this.getFileContent(),
    });
  }

  isRoot(): boolean {
    return this.root;
  }
}
