import type { ParsedSubagent } from "../../types/subagent.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { fileExists, resolvePath } from "../../utils/file.js";
import { BaseSubagentParser } from "./base.js";
import { parseSubagentsFromDirectory } from "./shared.js";

/**
 * Claude Code specific subagent parser
 */
export class ClaudeCodeSubagentParser extends BaseSubagentParser {
  getToolName(): ToolTarget {
    return "claudecode";
  }

  getAgentsDirectory(): string {
    return ".claude/agents";
  }

  async parseSubagents(baseDir: string): Promise<ParsedSubagent[]> {
    const agentsDir = resolvePath(this.getAgentsDirectory(), baseDir);
    if (await fileExists(agentsDir)) {
      return parseSubagentsFromDirectory(agentsDir);
    }
    return [];
  }
}
