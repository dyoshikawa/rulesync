import { AUGMENTCODE_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import type { Logger } from "../../utils/logger.js";
import {
  AugmentcodeSubagent,
  type AugmentcodeSubagentFrontmatter,
} from "./augmentcode-subagent.js";
import type { RulesyncSubagent } from "./rulesync-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * The frontmatter keys Auggie's plugin agent loader reads (Auggie CLI 0.36.0):
 * the agent's name comes from its file name, and only `description`, `model`
 * and `hidden` are taken from the frontmatter. Everything else the
 * `.augment/agents/` loader honors — `tools`, `disabled_tools`, `color`,
 * provider and prompt settings — is silently ignored for a plugin agent, so it
 * is dropped with a warning instead of being shipped in the bundle.
 * `name` is kept because rulesync's subagent format requires it.
 */
const PLUGIN_SUPPORTED_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "description",
  "model",
  "hidden",
]);

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
    const dropped = Object.keys(sanitized).filter((field) => !PLUGIN_SUPPORTED_FIELDS.has(field));
    for (const field of dropped) {
      delete sanitized[field];
    }
    if (dropped.length > 0) {
      const restrictsTools = dropped.includes("tools") || dropped.includes("disabled_tools");
      logger?.warn(
        `Dropping ${dropped.join(", ")} from augmentcode-plugin subagent ${relativeFilePath}: ` +
          `Auggie ignores these fields for plugin-shipped agents` +
          (restrictsTools ? ", so the agent runs with the full tool set." : "."),
      );
    }
    return sanitized;
  }
}
