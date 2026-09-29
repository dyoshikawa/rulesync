import { AUGMENTCODE_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import type { Logger } from "../../utils/logger.js";
import {
  AugmentcodeSubagent,
  type AugmentcodeSubagentFrontmatter,
} from "./augmentcode-subagent.js";
import type { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Frontmatter fields the `.augment/agents/` loader honors but Auggie's plugin
 * agent loader does not: a plugin agent keeps only its file name,
 * `description`, `model` and `hidden` (Auggie CLI 0.36.0). Writing a tool
 * restriction that is silently ignored would ship an unrestricted agent, so
 * these are dropped with a warning instead.
 */
const PLUGIN_UNSUPPORTED_FIELDS = ["tools", "disabled_tools", "color"] as const;

/**
 * Subagent inside an Auggie plugin bundle (`<plugin>/agents/<name>.md`). The
 * plugin has no cross-tool `.agents/` import root, so only its own `agents/`
 * directory is read.
 *
 * @see https://docs.augmentcode.com/cli/plugins
 */
export class AugmentcodePluginSubagent extends AugmentcodeSubagent {
  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "augmentcode-plugin",
    });
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: AUGMENTCODE_PLUGIN_AGENTS_DIR };
  }

  protected static override sanitizeFrontmatter({
    frontmatter,
    relativeFilePath,
    logger,
  }: {
    frontmatter: AugmentcodeSubagentFrontmatter;
    relativeFilePath: string;
    logger?: Logger;
  }): AugmentcodeSubagentFrontmatter {
    const sanitized: AugmentcodeSubagentFrontmatter = { ...frontmatter };
    const dropped = PLUGIN_UNSUPPORTED_FIELDS.filter((field) => sanitized[field] !== undefined);
    for (const field of PLUGIN_UNSUPPORTED_FIELDS) {
      delete sanitized[field];
    }
    if (dropped.length > 0) {
      logger?.warn(
        `Dropping ${dropped.join(", ")} from augmentcode-plugin subagent ${relativeFilePath}: ` +
          `Auggie ignores these fields for plugin-shipped agents.`,
      );
    }
    return sanitized;
  }
}
