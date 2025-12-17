import { join } from "node:path";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export class CodexCliSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".codex", "subagents"),
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<CodexCliSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new CodexCliSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new CodexCliSubagent(baseParams);
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "codexcli",
    });
  }

  static forDeletion(params: ToolSubagentForDeletionParams): CodexCliSubagent {
    return new CodexCliSubagent(this.forDeletionDefault(params));
  }
}
