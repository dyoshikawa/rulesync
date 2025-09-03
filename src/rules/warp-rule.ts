import { join } from "node:path";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromFileParams, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type WarpRuleParams = AiFileParams & {
  root?: boolean;
};

export class WarpRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: WarpRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<WarpRule> {
    // Read file content
    const fileContent = await readFileContent(join(baseDir, relativeFilePath));

    // Determine if it's a root file based on path
    const isRoot = relativeFilePath === "WARP.md";

    return new WarpRule({
      baseDir,
      relativeDirPath: isRoot ? "." : ".warp",
      relativeFilePath: isRoot ? "WARP.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): WarpRule {
    return new WarpRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: { relativeDirPath: ".", relativeFilePath: "WARP.md" },
        nonRootPath: { relativeDirPath: ".warp/memories" },
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
