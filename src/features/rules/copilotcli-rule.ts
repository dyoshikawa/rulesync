import { ToolTarget } from "../../types/tool-targets.js";
import { CopilotRule } from "./copilot-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
} from "./tool-rule.js";

export class CopilotcliRule extends CopilotRule {
  private static fromCopilotRule(copilotRule: CopilotRule, validate = true): CopilotcliRule {
    return new CopilotcliRule({
      outputRoot: copilotRule.getOutputRoot(),
      relativeDirPath: copilotRule.getRelativeDirPath(),
      relativeFilePath: copilotRule.getRelativeFilePath(),
      frontmatter: copilotRule.getFrontmatter(),
      body: copilotRule.getBody(),
      validate,
      root: copilotRule.isRoot(),
    });
  }

  static override fromRulesyncRule({
    validate = true,
    ...rest
  }: ToolRuleFromRulesyncRuleParams): CopilotcliRule {
    return this.fromCopilotRule(CopilotRule.fromRulesyncRule({ validate, ...rest }), validate);
  }

  static override async fromFile({
    validate = true,
    ...rest
  }: ToolRuleFromFileParams): Promise<CopilotcliRule> {
    return this.fromCopilotRule(await CopilotRule.fromFile({ validate, ...rest }), validate);
  }

  static override forDeletion(params: ToolRuleForDeletionParams): CopilotcliRule {
    return this.fromCopilotRule(CopilotRule.forDeletion(params), false);
  }

  static override isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "copilotcli" satisfies ToolTarget,
    });
  }
}
