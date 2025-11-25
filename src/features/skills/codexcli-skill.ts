import { join } from "node:path";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill, SimulatedSkillParams } from "./simulated-skill.js";
import {
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Represents a simulated skill for Codex CLI.
 * Since Codex CLI doesn't have native skill support, this provides
 * a compatible skill directory format at .codex/skills/.
 */
export class CodexCliSkill extends SimulatedSkill {
  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    if (options?.global) {
      throw new Error("CodexCliSkill does not support global mode.");
    }
    return {
      relativeDirPath: join(".codex", "skills"),
    };
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CodexCliSkill> {
    const baseParams = await this.fromDirDefault(params);
    return new CodexCliSkill(baseParams);
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): CodexCliSkill {
    const baseParams: SimulatedSkillParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
    };
    return new CodexCliSkill(baseParams);
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "codexcli",
    });
  }
}
