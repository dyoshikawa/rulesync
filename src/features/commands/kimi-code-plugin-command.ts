import { z } from "zod/mini";

import { KIMI_CODE_PLUGIN_COMMANDS_DIR } from "../../constants/plugin-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * Kimi Code reads only `name` and `description` from a plugin command. The
 * name defaults to the file's path under `commands/` (without `.md`), so it is
 * written only when the `kimi-code-plugin` section of a Rulesync command sets
 * one.
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const KimiCodePluginCommandFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
});

export type KimiCodePluginCommandFrontmatter = z.infer<
  typeof KimiCodePluginCommandFrontmatterSchema
>;

/**
 * Slash command inside a Kimi Code plugin bundle (`<plugin>/commands/**\/*.md`),
 * registered as `/<plugin>:<name>` when the manifest declares
 * `"commands": "./commands/"`. `$ARGUMENTS` in the body is replaced with the
 * typed arguments, which are otherwise appended as `ARGUMENTS: <text>`.
 *
 * Plugins are Kimi Code's only file-based command surface; the plain
 * `kimi-code` target has none.
 *
 * @see https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.1.1/docs/en/customization/plugins.md
 */
export class KimiCodePluginCommand extends FrontmatterMarkdownToolCommand<KimiCodePluginCommandFrontmatter> {
  static getSettablePaths(): ToolCommandSettablePaths {
    return { relativeDirPath: KIMI_CODE_PLUGIN_COMMANDS_DIR };
  }

  protected static override getToolTarget(): ToolTarget {
    return "kimi-code-plugin";
  }

  protected static override getFrontmatterSchema() {
    return KimiCodePluginCommandFrontmatterSchema;
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): KimiCodePluginCommandFrontmatter {
    const toolFields = rulesyncFrontmatter["kimi-code-plugin"] ?? {};
    return {
      ...(rulesyncFrontmatter.description !== undefined && {
        description: rulesyncFrontmatter.description,
      }),
      ...toolFields,
    };
  }

  protected static override getDeletionFrontmatter(): KimiCodePluginCommandFrontmatter {
    return {};
  }
}
