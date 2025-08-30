import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

/**
 * Rule generator for Claude Code AI assistant
 *
 * Generates CLAUDE.md memory files based on rulesync rule content.
 * Supports the Claude Code memory system with import references.
 */
export class ClaudecodeRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<ClaudecodeRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    return new ClaudecodeRule({
      baseDir: params.baseDir || process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      validate: params.validate ?? true,
      root: params.relativeFilePath === "CLAUDE.md",
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
        root,
        relativeDirPath: ".",
      });
    }

    return new ClaudecodeRule({
      ...rest,
      fileContent: body,
      relativeDirPath: join(".claude", "memories"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      root: this.isRoot(),
      targets: ["*"],
      description: "",
      globs: this.isRoot() ? ["**/*"] : [],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
