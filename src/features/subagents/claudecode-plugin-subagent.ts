import { CLAUDECODE_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import type { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

export class ClaudecodePluginSubagent extends ClaudecodeSubagent {
  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    const targets = rulesyncSubagent.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("claudecode-plugin");
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: CLAUDECODE_PLUGIN_AGENTS_DIR };
  }
}
