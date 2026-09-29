import { AUGMENTCODE_PLUGIN_COMMANDS_DIR } from "../../constants/plugin-paths.js";
import { AugmentcodeCommand } from "./augmentcode-command.js";
import type { RulesyncCommand } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * Slash command inside an Auggie plugin bundle (`<plugin>/commands/<name>.md`).
 *
 * @see https://docs.augmentcode.com/cli/plugins
 */
export class AugmentcodePluginCommand extends AugmentcodeCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "augmentcode-plugin",
    });
  }

  static override getSettablePaths(): ToolCommandSettablePaths {
    return { relativeDirPath: AUGMENTCODE_PLUGIN_COMMANDS_DIR };
  }

  /**
   * A plugin has no cross-tool `.agents/commands/` root: everything it ships
   * lives under the plugin's own `commands/`.
   */
  static override async loadAdditionalImportFiles(): Promise<AugmentcodeCommand[]> {
    return [];
  }
}
