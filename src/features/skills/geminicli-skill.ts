import { join } from "node:path";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill, SimulatedSkillParams } from "./simulated-skill.js";
import {
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Represents a simulated skill for Gemini CLI.
 * Since Gemini CLI doesn't have native skill support, this provides
 * a compatible skill directory format at .gemini/skills/.
 */
export class GeminiCliSkill extends SimulatedSkill {
  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    if (options?.global) {
      throw new Error("GeminiCliSkill does not support global mode.");
    }
    return {
      relativeDirPath: join(".gemini", "skills"),
    };
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<GeminiCliSkill> {
    const baseParams = await this.fromDirDefault(params);
    return new GeminiCliSkill(baseParams);
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): GeminiCliSkill {
    const baseParams: SimulatedSkillParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
    };
    return new GeminiCliSkill(baseParams);
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "geminicli",
    });
  }
}
