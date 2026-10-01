import { AUGMENTCODE_PLUGIN_COMMANDS_DIR } from "../../constants/plugin-paths.js";
import type { Logger } from "../../utils/logger.js";
import { AugmentcodeCommand, type AugmentcodeCommandFrontmatter } from "./augmentcode-command.js";
import type { RulesyncCommand } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * The frontmatter keys Auggie's plugin command loader reads: only
 * `description` and `model`. Everything else the `.augment/commands/` loader
 * honors — notably `argument-hint` — is ignored for a plugin command, so it is
 * dropped with a warning instead of being shipped in the bundle.
 */
const PLUGIN_SUPPORTED_FIELDS: ReadonlySet<string> = new Set(["description", "model"]);

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

  protected static override sanitizeFrontmatter({
    frontmatter,
    relativeFilePath,
    logger,
  }: {
    frontmatter: AugmentcodeCommandFrontmatter;
    relativeFilePath: string;
    logger?: Logger;
  }): AugmentcodeCommandFrontmatter {
    const sanitized: AugmentcodeCommandFrontmatter = { ...frontmatter };
    const dropped = Object.keys(sanitized).filter((field) => !PLUGIN_SUPPORTED_FIELDS.has(field));
    for (const field of dropped) {
      delete sanitized[field];
    }
    if (dropped.length > 0) {
      logger?.warn(
        `Dropping ${dropped.join(", ")} from augmentcode-plugin command ${relativeFilePath}: ` +
          `Auggie ignores these fields for plugin-shipped commands.`,
      );
    }
    return sanitized;
  }
}
