import { ZCODE_PLUGIN_COMMANDS_DIR } from "../../constants/plugin-paths.js";
import type { RulesyncCommand } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";
import { ZcodeCommand } from "./zcode-command.js";

/**
 * Command inside a ZCode plugin bundle (`<plugin>/commands/<name>.md`). ZCode
 * parses plugin commands with the same loader as `.zcode/commands/`, so the
 * frontmatter is unchanged.
 *
 * @see https://zcode.z.ai/en/docs/plugin
 */
export class ZcodePluginCommand extends ZcodeCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    const targets = rulesyncCommand.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("zcode-plugin");
  }

  static override getSettablePaths(): ToolCommandSettablePaths {
    return { relativeDirPath: ZCODE_PLUGIN_COMMANDS_DIR };
  }
}
