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

export class CursorSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".cursor", "agents"),
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<CursorSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new CursorSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new CursorSubagent(baseParams);
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "cursor",
    });
  }

  static forDeletion(params: ToolSubagentForDeletionParams): CursorSubagent {
    return new CursorSubagent(this.forDeletionDefault(params));
  }
}
