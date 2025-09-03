import { join } from "node:path";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromFileParams, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

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

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AgentsMdRule> {
    // Read file content
    const fileContent = await readFileContent(join(baseDir, relativeFilePath));

    // Determine if it's a root file based on path
    const isRoot = relativeFilePath === "AGENTS.md";

    return new AgentsMdRule({
      baseDir,
      relativeDirPath: ".",
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
    return new AgentsMdRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // AGENTS.md rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }
}
