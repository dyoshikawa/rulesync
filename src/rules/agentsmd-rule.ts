import { readFile } from "node:fs/promises";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type AgentsMdRuleParams = AiFileParams & {
  root?: boolean;
};

export class AgentsMdRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: AgentsMdRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<AgentsMdRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");

    // Determine if it's a root file based on path
    const isRoot = relativeFilePath === "AGENTS.md";

    return new AgentsMdRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AgentsMdRule {
    const root = rulesyncRule.getFrontmatter().root;
    const fileContent = rulesyncRule.getBody();

    if (root) {
      return new AgentsMdRule({
        baseDir,
        relativeDirPath: "",
        relativeFilePath: "AGENTS.md",
        fileContent,
        validate,
        root,
      });
    }

    return new AgentsMdRule({
      baseDir,
      relativeDirPath: ".agents/memories",
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      fileContent,
      validate,
      root: root ?? false,
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
    // AGENTS.md rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }
}
