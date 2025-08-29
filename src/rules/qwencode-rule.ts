import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export interface QwencodeRuleParams extends ToolRuleParams {
  body: string;
}

/**
 * Rule generator for Qwen Code AI assistant
 *
 * Generates QWEN.md memory files based on rulesync rule content.
 * Supports the Qwen Code context management system with hierarchical discovery.
 */
export class QwencodeRule extends ToolRule {
  constructor(params: QwencodeRuleParams) {
    super({
      ...params,
    });
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<QwencodeRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    return new QwencodeRule({
      baseDir: params.baseDir || process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      body: fileContent,
      validate: params.validate ?? true,
      root: params.relativeFilePath === "QWEN.md",
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): QwencodeRule {
    const { rulesyncRule, ...rest } = params;

    const root = rulesyncRule.getFrontmatter().root;
    const body = rulesyncRule.getBody();

    if (root) {
      return new QwencodeRule({
        ...rest,
        fileContent: body,
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        body,
        root,
      });
    }

    return new QwencodeRule({
      ...rest,
      fileContent: body,
      relativeDirPath: join(".qwen", "memories"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["qwencode"],
      description: "",
      globs: ["**/*"],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      fileContent: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
