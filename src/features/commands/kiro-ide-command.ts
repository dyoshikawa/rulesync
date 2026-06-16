import { KiroCommand } from "./kiro-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * Command generator for the **Kiro IDE**. Kiro IDE and CLI share the same
 * command format, so this reuses {@link KiroCommand} and only narrows targeting
 * to `kiro-ide`.
 */
export class KiroIdeCommand extends KiroCommand {
  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "kiro-ide",
    });
  }
}
