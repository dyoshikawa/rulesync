import { join } from "node:path";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill, SimulatedSkillParams } from "./simulated-skill.js";
import {
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Represents a simulated skill for OpenCode.
 * Since OpenCode doesn't have native skill support, this provides
 * a compatible skill directory format at .opencode/skills/.
 */
export class OpencodeSkill extends SimulatedSkill {
  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    if (options?.global) {
      throw new Error("OpencodeSkill does not support global mode.");
    }
    return {
      relativeDirPath: join(".opencode", "skills"),
    };
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<OpencodeSkill> {
    const baseParams = await this.fromDirDefault(params);
    return new OpencodeSkill(baseParams);
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): OpencodeSkill {
    const baseParams: SimulatedSkillParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
    };
    return new OpencodeSkill(baseParams);
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "opencode",
    });
  }
}
