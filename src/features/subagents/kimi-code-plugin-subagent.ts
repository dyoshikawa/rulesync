import { KIMI_CODE_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import { KimiCodeSubagent } from "./kimi-code-subagent.js";
import type { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Subagent inside a Kimi Code plugin bundle (`<plugin>/agents/<name>.md`).
 * Kimi auto-discovers `agents/` when the manifest declares no `agents` paths
 * and reads the files in the same format as `.kimi-code/agents/`.
 *
 * @see https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.1.1/docs/en/customization/plugins.md
 */
export class KimiCodePluginSubagent extends KimiCodeSubagent {
  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "kimi-code-plugin",
    });
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: KIMI_CODE_PLUGIN_AGENTS_DIR };
  }

  /**
   * The bundle is read from `--output-root <plugin>`, but the imported rulesync
   * file belongs to the project's `.rulesync/`, not to the plugin root.
   */
  protected override getRulesyncOutputRoot(): string {
    return ".";
  }
}
