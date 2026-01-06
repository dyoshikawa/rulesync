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

export class AgentsmdSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".agents", "subagents"),
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<AgentsmdSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new AgentsmdSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new AgentsmdSubagent(baseParams);
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "agentsmd",
    });
  }

  static forDeletion(params: ToolSubagentForDeletionParams): AgentsmdSubagent {
    return new AgentsmdSubagent(this.forDeletionDefault(params));
  }
}
