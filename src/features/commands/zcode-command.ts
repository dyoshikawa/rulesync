import { z } from "zod/mini";

import { ZCODE_COMMANDS_DIR_PATH } from "../../constants/zcode-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * ZCode custom commands are Markdown files under `<project>/.zcode/commands/`
 * (workspace scope) and `~/.zcode/commands/` (user scope), invoked from the
 * input box with `/`. The docs spell out only the user path and place
 * workspace-level commands "in the project directory", so the `.zcode/commands/`
 * path is inferred from ZCode's workspace layout rather than documented. The create-command form carries a description shown in
 * the command picker and an argument hint, which map onto the same
 * `description` / `argument-hint` frontmatter keys the Claude-Code-lineage
 * tools use; the command's file name is its identifier.
 *
 * @see https://zcode.z.ai/en/docs/commands
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const ZcodeCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type ZcodeCommandFrontmatter = z.infer<typeof ZcodeCommandFrontmatterSchema>;

export class ZcodeCommand extends FrontmatterMarkdownToolCommand<ZcodeCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes use the same relative directory; the processor supplies the
    // home directory as outputRoot in global mode.
    return {
      relativeDirPath: ZCODE_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "zcode";
  }

  protected static override getFrontmatterSchema() {
    return ZcodeCommandFrontmatterSchema;
  }
}
