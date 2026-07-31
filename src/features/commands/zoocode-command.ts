import { stringifyFrontmatter } from "../../utils/frontmatter.js";
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

  override toRulesyncCommand(): RulesyncCommand {
    // Re-tag the import to this target: the base maps to `targets: ["roo"]`,
    // which a subsequent zoocode generate would skip.
    const command = super.toRulesyncCommand();
    const frontmatter = { ...command.getFrontmatter(), targets: ["zoocode" as const] };
    return new RulesyncCommand({
      outputRoot: command.getOutputRoot(),
      relativeDirPath: command.getRelativeDirPath(),
      relativeFilePath: command.getRelativeFilePath(),
      frontmatter,
      body: command.getBody(),
      fileContent: stringifyFrontmatter(command.getBody(), frontmatter),
      validate: true,
    });
  }
}
