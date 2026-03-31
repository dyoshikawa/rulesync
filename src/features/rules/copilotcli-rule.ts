import { ToolTarget } from "../../types/tool-targets.js";
import { CopilotRule } from "./copilot-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
} from "./tool-rule.js";

export class CopilotcliRule extends CopilotRule {
  private static fromCopilotRule(copilotRule: CopilotRule): CopilotcliRule {
    return new CopilotcliRule({
      baseDir: copilotRule.getBaseDir(),
      relativeDirPath: copilotRule.getRelativeDirPath(),
      relativeFilePath: copilotRule.getRelativeFilePath(),
      frontmatter: copilotRule.getFrontmatter(),
      body: copilotRule.getBody(),
      validate: true,
      root: copilotRule.isRoot(),
    });
  }

  static override fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): CopilotcliRule {
    return this.fromCopilotRule(CopilotRule.fromRulesyncRule(params));
  }

  static override async fromFile(params: ToolRuleFromFileParams): Promise<CopilotcliRule> {
    return this.fromCopilotRule(await CopilotRule.fromFile(params));
  }

  static override forDeletion(params: ToolRuleForDeletionParams): CopilotcliRule {
    return this.fromCopilotRule(CopilotRule.forDeletion(params));
  }

  static override isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "copilotcli" satisfies ToolTarget,
    });
  }
}
