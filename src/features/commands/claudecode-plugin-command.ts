import { CLAUDECODE_PLUGIN_COMMANDS_DIR } from "../../constants/plugin-paths.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import type { RulesyncCommand } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

export class ClaudecodePluginCommand extends ClaudecodeCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "claudecode-plugin",
    });
  }

  static override getSettablePaths(): ToolCommandSettablePaths {
    return { relativeDirPath: CLAUDECODE_PLUGIN_COMMANDS_DIR };
  }
}
