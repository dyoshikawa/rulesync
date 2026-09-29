import { AUGMENTCODE_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import { AugmentcodeSubagent } from "./augmentcode-subagent.js";
import type { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Subagent inside an Auggie plugin bundle (`<plugin>/agents/<name>.md`). The
 * plugin has no cross-tool `.agents/` import root, so only its own `agents/`
 * directory is read.
 *
 * @see https://docs.augmentcode.com/cli/plugins
 */
export class AugmentcodePluginSubagent extends AugmentcodeSubagent {
  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "augmentcode-plugin",
    });
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: AUGMENTCODE_PLUGIN_AGENTS_DIR };
  }
}
