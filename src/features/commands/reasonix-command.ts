import { z } from "zod/mini";

import { REASONIX_COMMANDS_DIR_PATH } from "../../constants/reasonix-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  FrontmatterMarkdownToolCommand,
  type FrontmatterMarkdownToolCommandParams,
} from "./frontmatter-markdown-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * Reasonix custom slash commands are Markdown files under `.reasonix/commands/`
 * (project) / `~/.reasonix/commands/` (global) — directly analogous to Claude
 * Code's `.claude/commands/` (Reasonix explicitly copies Claude Code's
 * conventions). Frontmatter supports `description` and `argument-hint`; the
 * body uses the same `$ARGUMENTS` / `$1`…`$N` placeholder syntax rulesync's
 * universal command-body syntax already targets.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const ReasonixCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type ReasonixCommandFrontmatter = z.infer<typeof ReasonixCommandFrontmatterSchema>;

export type ReasonixCommandParams =
  FrontmatterMarkdownToolCommandParams<ReasonixCommandFrontmatter>;

export class ReasonixCommand extends FrontmatterMarkdownToolCommand<ReasonixCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both project and global scope use the same relative dir; the processor
    // supplies the home directory as outputRoot in global mode.
    return {
      relativeDirPath: REASONIX_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "reasonix";
  }

  protected static override getFrontmatterSchema() {
    return ReasonixCommandFrontmatterSchema;
  }
}
