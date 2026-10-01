import { ZCODE_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import type { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";
import { ZcodeSubagent } from "./zcode-subagent.js";

/**
 * Subagent inside a ZCode plugin bundle (`<plugin>/agents/<name>.md`). ZCode
 * parses plugin agents like user (`~/.zcode/agents/`) ones, so `permissionMode`
 * is kept, unlike for project-scope `.zcode/agents/`.
 *
 * @see https://zcode.z.ai/en/docs/plugin
 */
export class ZcodePluginSubagent extends ZcodeSubagent {
  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "zcode-plugin",
    });
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: ZCODE_PLUGIN_AGENTS_DIR };
  }

  protected static override dropsPermissionMode(): boolean {
    return false;
  }
}
