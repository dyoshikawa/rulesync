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

export class CopilotSubagent extends SimulatedSubagent {
  static getSettablePaths(): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".github", "agents"),
    };
  }

  static async fromFile(params: ToolSubagentFromFileParams): Promise<CopilotSubagent> {
    const baseParams = await this.fromFileDefault(params);
    return new CopilotSubagent(baseParams);
  }

  static fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const { baseDir = process.cwd(), relativeDirPath, rulesyncSubagent, validate = true } = params;
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const copilotConfig = rulesyncFrontmatter.copilot;
    const userTools = Array.isArray(copilotConfig?.tools)
      ? copilotConfig.tools.filter((tool): tool is string => typeof tool === "string")
      : [];
    const tools = Array.from(new Set(["agent/runSubagent", ...userTools]));

    return new CopilotSubagent({
      baseDir,
      relativeDirPath: relativeDirPath ?? this.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      frontmatter: {
        name: rulesyncFrontmatter.name,
        description: rulesyncFrontmatter.description,
        ...(tools.length > 0 ? { tools } : {}),
      },
      body: rulesyncSubagent.getBody(),
      validate,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "copilot",
    });
  }

  static forDeletion(params: ToolSubagentForDeletionParams): CopilotSubagent {
    return new CopilotSubagent(this.forDeletionDefault(params));
  }
}
