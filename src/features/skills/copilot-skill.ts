import { join } from "node:path";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill, SimulatedSkillParams } from "./simulated-skill.js";
import {
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Represents a simulated skill for GitHub Copilot.
 * Since Copilot doesn't have native skill support, this provides
 * a compatible skill directory format at .github/skills/.
 */
export class CopilotSkill extends SimulatedSkill {
  static getSettablePaths(_options?: { global?: boolean }): ToolSkillSettablePaths {
    return {
      relativeDirPath: join(".github", "skills"),
    };
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CopilotSkill> {
    const baseParams = await this.fromDirDefault(params);
    return new CopilotSkill(baseParams);
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): CopilotSkill {
    const baseParams: SimulatedSkillParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
    };
    return new CopilotSkill(baseParams);
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "copilot",
    });
  }
}
