import { join } from "node:path";

import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill, SimulatedSkillParams } from "./simulated-skill.js";
import {
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Represents a simulated skill for AGENTS.md.
 * Since AGENTS.md doesn't have native skill support, this provides
 * a compatible skill directory format at .agents/skills/.
 */
export class AgentsmdSkill extends SimulatedSkill {
  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    if (options?.global) {
      throw new Error("AgentsmdSkill does not support global mode.");
    }
    return {
      relativeDirPath: join(".agents", "skills"),
    };
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<AgentsmdSkill> {
    const baseParams = await this.fromDirDefault(params);
    return new AgentsmdSkill(baseParams);
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): AgentsmdSkill {
    const baseParams: SimulatedSkillParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
    };
    return new AgentsmdSkill(baseParams);
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "agentsmd",
    });
  }

  static forDeletion(params: ToolSkillForDeletionParams): AgentsmdSkill {
    const baseParams = this.forDeletionDefault(params);
    return new AgentsmdSkill(baseParams);
  }
}
