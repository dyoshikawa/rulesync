import { RooCommand } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";

/**
 * Command generator for **Zoo Code** (the community continuation of Roo Code).
 * Zoo Code keeps Roo's `.roo/commands/` layout, so this target reuses
 * {@link RooCommand} verbatim and only narrows the targeting.
 *
 * @see https://docs.zoocode.dev
 */
export class ZoocodeCommand extends RooCommand {
  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "zoocode",
    });
  }
}
