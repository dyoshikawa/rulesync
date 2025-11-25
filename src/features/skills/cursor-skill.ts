import { join } from "node:path";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill, SimulatedSkillParams } from "./simulated-skill.js";
import {
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Represents a simulated skill for Cursor.
 * Since Cursor doesn't have native skill support, this provides
 * a compatible skill directory format at .cursor/skills/.
 */
export class CursorSkill extends SimulatedSkill {
  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    if (options?.global) {
      throw new Error("CursorSkill does not support global mode.");
    }
    return {
      relativeDirPath: join(".cursor", "skills"),
    };
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CursorSkill> {
    const baseParams = await this.fromDirDefault(params);
    return new CursorSkill(baseParams);
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): CursorSkill {
    const baseParams: SimulatedSkillParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
    };
    return new CursorSkill(baseParams);
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "cursor",
    });
  }
}
