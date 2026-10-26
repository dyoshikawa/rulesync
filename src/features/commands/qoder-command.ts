import { z } from "zod/mini";

import { QODER_COMMANDS_DIR_PATH } from "../../constants/qoder-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  FrontmatterMarkdownToolCommand,
  type FrontmatterMarkdownToolCommandParams,
} from "./frontmatter-markdown-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const QoderCommandFrontmatterSchema = z.looseObject({
  // Required by Qoder: shown in the TUI command list.
  description: z.optional(z.string()),
  // Display name in the TUI only; the invocation name always comes from the
  // file path, so rulesync never derives it.
  name: z.optional(z.string()),
});

export type QoderCommandFrontmatter = z.infer<typeof QoderCommandFrontmatterSchema>;

export type QoderCommandParams = FrontmatterMarkdownToolCommandParams<QoderCommandFrontmatter>;

/**
 * Custom slash command for Qoder.
 *
 * Qoder reads Markdown prompt commands with YAML frontmatter from
 * `.qoder/commands/` (project) and `~/.qoder/commands/` (user). The command's
 * invocation name is derived from its path — subdirectories namespace with
 * `:`, so `git/commit.md` registers as `/git:commit` — and the frontmatter
 * `name` is only the TUI display label. rulesync writes the rulesync
 * `description` plus any fields of the `qoder` section (which win over the
 * shared ones), and keeps nested command paths.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/command
 */
export class QoderCommand extends FrontmatterMarkdownToolCommand<QoderCommandFrontmatter> {
  // Both scopes share the same relative path; the home-directory root is
  // applied by the generate pipeline in global mode.
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: QODER_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "qoder";
  }

  protected static override getFrontmatterSchema() {
    return QoderCommandFrontmatterSchema;
  }
}
