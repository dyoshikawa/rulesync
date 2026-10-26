import { z } from "zod/mini";

import { CODEBUDDY_COMMANDS_DIR_PATH } from "../../constants/codebuddy-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  FrontmatterMarkdownToolCommand,
  type FrontmatterMarkdownToolCommandParams,
} from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * CodeBuddy Code custom slash commands are Markdown files under
 * `.codebuddy/commands/` (project scope; subdirectories group commands and are
 * invoked as `/dir:name`) and `~/.codebuddy/commands/` (user scope). The file
 * name is the command's identifier. The documented frontmatter is
 * `description`, `argument-hint`, `model`, `allowed-tools` and
 * `disable-model-invocation`; everything beyond `description` round-trips
 * through the `codebuddy` section.
 *
 * @see https://www.codebuddy.ai/docs/cli/slash-commands
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const CodebuddyCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type CodebuddyCommandFrontmatter = z.infer<typeof CodebuddyCommandFrontmatterSchema>;

export type CodebuddyCommandParams =
  FrontmatterMarkdownToolCommandParams<CodebuddyCommandFrontmatter>;

export class CodebuddyCommand extends FrontmatterMarkdownToolCommand<CodebuddyCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes use the same relative directory; the processor supplies the
    // home directory as outputRoot in global mode.
    return {
      relativeDirPath: CODEBUDDY_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "codebuddy";
  }

  protected static override getFrontmatterSchema() {
    return CodebuddyCommandFrontmatterSchema;
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): CodebuddyCommandFrontmatter {
    // The canonical description always wins over a stray same-named key in
    // the `codebuddy` section, matching the CodeBuddy skill and subagent.
    const { description: _description, ...codebuddyFields } = rulesyncFrontmatter.codebuddy ?? {};

    return {
      description: rulesyncFrontmatter.description,
      ...codebuddyFields,
    };
  }
}
