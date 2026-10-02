import { DEVIN_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import { DevinSubagent } from "./devin-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Subagent inside a Devin plugin bundle (`<plugin>/agents/<name>/AGENT.md`).
 * Plugin subagents use the same profile format as project ones and are
 * exposed as `<plugin>:<name>`. Devin also reads a flat `agents/<name>.md`;
 * the directory form is written to match the `devin` target.
 *
 * @see https://docs.devin.ai/cli/extensibility/plugins/overview
 */
export class DevinPluginSubagent extends DevinSubagent {
  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "devin-plugin",
    });
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: DEVIN_PLUGIN_AGENTS_DIR };
  }

  /**
   * The bundle is read from `--output-root <plugin>`, but the imported rulesync
   * file belongs to the project's `.rulesync/`, not to the plugin root.
   */
  override toRulesyncSubagent(): RulesyncSubagent {
    const rulesyncSubagent = super.toRulesyncSubagent();
    return new RulesyncSubagent({
      outputRoot: ".",
      relativeDirPath: rulesyncSubagent.getRelativeDirPath(),
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      frontmatter: rulesyncSubagent.getFrontmatter(),
      body: rulesyncSubagent.getBody(),
      validate: false,
    });
  }
}
