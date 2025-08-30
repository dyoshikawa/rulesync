import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

/**
 * Rule generator for OpenAI Codex CLI
 *
 * Generates AGENTS.md files based on rulesync rule content.
 * Supports the OpenAI Codex CLI memory/instructions system with
 * hierarchical loading (global, project, directory-specific).
 */
export class CodexcliRule extends ToolRule {
  static async fromFilePath(params: AiFileFromFilePathParams): Promise<CodexcliRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    return new CodexcliRule({
      baseDir: params.baseDir || process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      validate: params.validate ?? true,
      root: params.relativeFilePath === "AGENTS.md",
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): CodexcliRule {
    const { rulesyncRule, ...rest } = params;

    const root = rulesyncRule.getFrontmatter().root;
    const body = rulesyncRule.getBody();

    if (root) {
      return new CodexcliRule({
        ...rest,
        fileContent: body,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        root,
      });
    }

    return new CodexcliRule({
      ...rest,
      fileContent: body,
      relativeDirPath: join(".codex", "memories"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      root: this.isRoot(),
      targets: ["codexcli"],
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
    // OpenAI Codex CLI rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }
}
