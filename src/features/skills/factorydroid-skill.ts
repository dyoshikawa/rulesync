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
 * Represents a simulated skill for Factory Droid.
 * Since Factory Droid uses AGENTS.md format, this provides
 * a compatible skill directory format at .factory/skills/.
 */
export class FactorydroidSkill extends SimulatedSkill {
  static getSettablePaths(_options?: { global?: boolean }): ToolSkillSettablePaths {
    return {
      relativeDirPath: join(".factory", "skills"),
    };
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<FactorydroidSkill> {
    const baseParams = await this.fromDirDefault(params);
    return new FactorydroidSkill(baseParams);
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): FactorydroidSkill {
    const baseParams: SimulatedSkillParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
    };
    return new FactorydroidSkill(baseParams);
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "factorydroid",
    });
  }

  static forDeletion(params: ToolSkillForDeletionParams): FactorydroidSkill {
    const baseParams = this.forDeletionDefault(params);
    return new FactorydroidSkill(baseParams);
  }
}
