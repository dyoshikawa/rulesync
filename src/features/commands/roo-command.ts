import { z } from "zod/mini";

import { ROO_COMMANDS_DIR_PATH } from "../../constants/roo-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const RooCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
  // Mode slug (e.g. "code", "architect") to switch to before running the command body.
  // https://roocodeinc.github.io/Roo-Code/features/slash-commands
  mode: z.optional(z.string()),
});

export type RooCommandFrontmatter = z.infer<typeof RooCommandFrontmatterSchema>;

export class RooCommand extends FrontmatterMarkdownToolCommand<RooCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Project `.roo/commands/` and global `~/.roo/commands/` share the same
    // relative dir (the global root resolves under the home directory) — the
    // same no-branch approach RooRule and RooSkill use.
    // @see https://roocodeinc.github.io/Roo-Code/features/slash-commands
    return {
      relativeDirPath: ROO_COMMANDS_DIR_PATH,
    };
  }

  /** Also the key of the `roo:` section, which Zoo Code reads too. */
  protected static override getToolTarget(): ToolTarget {
    return "roo";
  }

  protected static override getFrontmatterSchema() {
    return RooCommandFrontmatterSchema;
  }

  protected static override getImportTargets(): RulesyncCommandFrontmatter["targets"] {
    return ["roo"];
  }
}
