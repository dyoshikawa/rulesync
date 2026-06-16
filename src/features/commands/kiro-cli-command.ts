import { KiroCommand } from "./kiro-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * Command generator for the **Kiro CLI**. Kiro IDE and CLI share the same
 * command format, so this reuses {@link KiroCommand} and only narrows targeting
 * to `kiro-cli`.
 */
export class KiroCliCommand extends KiroCommand {
  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "kiro-cli",
    });
  }
}
