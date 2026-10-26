import { z } from "zod/mini";

import { BOB_COMMANDS_DIR_PATH } from "../../constants/bob-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  FrontmatterMarkdownToolCommand,
  type FrontmatterMarkdownToolCommandParams,
} from "./frontmatter-markdown-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * IBM Bob slash commands are Markdown files under `<project>/.bob/commands/`
 * (project scope) and `~/.bob/commands/` (user scope), invoked from the chat
 * input with `/`. The file name is the command name; the optional
 * `description` / `argument-hint` frontmatter keys are the same ones the
 * Claude-Code-lineage tools use, and the body is the prompt Bob runs.
 *
 * @see https://bob.ibm.com/docs/ide/features/slash-commands
 * @see https://bob.ibm.com/docs/shell/features/slash-commands
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const BobCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type BobCommandFrontmatter = z.infer<typeof BobCommandFrontmatterSchema>;

export type BobCommandParams = FrontmatterMarkdownToolCommandParams<BobCommandFrontmatter>;

export class BobCommand extends FrontmatterMarkdownToolCommand<BobCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes use the same relative directory; the processor supplies the
    // home directory as outputRoot in global mode.
    return {
      relativeDirPath: BOB_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "bob";
  }

  protected static override getFrontmatterSchema() {
    return BobCommandFrontmatterSchema;
  }
}
