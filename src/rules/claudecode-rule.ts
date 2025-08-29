import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export interface ClaudecodeRuleParams extends AiFileParams {
  body: string;
}

/**
 * Rule generator for Claude Code AI assistant
 *
 * Generates CLAUDE.md memory files based on rulesync rule content.
 * Supports the Claude Code memory system with import references.
 */
export class ClaudecodeRule extends ToolRule {
  constructor(params: ClaudecodeRuleParams) {
    super({
      ...params,
    });
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<ClaudecodeRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    return new ClaudecodeRule({
      baseDir: params.baseDir || process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      body: fileContent,
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    const { rulesyncRule, ...rest } = params;

    const root = rulesyncRule.getFrontmatter().root;
    const body = rulesyncRule.getBody();

    if (root) {
      return new ClaudecodeRule({
        ...rest,
        fileContent: body,
        relativeFilePath: "CLAUDE.md",
        body,
      });
    }

    return new ClaudecodeRule({
      ...rest,
      fileContent: body,
      relativeDirPath: join(".claude", "memories"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["claudecode"],
      description: "",
      globs: ["**/*"],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: this.getRelativeDirPath(),
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
