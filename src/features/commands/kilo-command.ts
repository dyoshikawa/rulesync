import { basename } from "node:path";

import { z } from "zod/mini";

import {
  KILO_COMMANDS_DIR_PATH,
  KILO_GLOBAL_COMMANDS_DIR_PATH,
} from "../../constants/kilo-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommand } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

export const KiloCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  agent: z.optional(z.string()),
  subtask: z.optional(z.boolean()),
  model: z.optional(z.string()),
  // Reasoning-effort override (e.g. `low` / `high`) for models that support
  // variants — the fifth field of Kilo's command schema, and the same key
  // `KiloSubagentFrontmatterSchema` models.
  // https://kilo.ai/docs/customize/workflows
  variant: z.optional(z.string()),
});

export type KiloCommandFrontmatter = z.infer<typeof KiloCommandFrontmatterSchema>;

/**
 * Command names Kilo keeps for itself. Its loader throws on a custom command
 * file named `goal.md` in either the project or the global directory ("The
 * /goal command is reserved for session goals. Rename the custom command."),
 * and a throw there aborts the whole command scan — every other custom
 * command becomes unreachable too, not only the reserved one.
 * https://github.com/Kilo-Org/kilocode/blob/v7.6.2/packages/opencode/src/command/index.ts
 */
const KILO_RESERVED_COMMAND_NAMES: ReadonlySet<string> = new Set(["goal"]);

export class KiloCommand extends FrontmatterMarkdownToolCommand<KiloCommandFrontmatter> {
  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: global ? KILO_GLOBAL_COMMANDS_DIR_PATH : KILO_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "kilo";
  }

  protected static override getFrontmatterSchema() {
    return KiloCommandFrontmatterSchema;
  }

  /**
   * Refuse to write a command Kilo reserves (see
   * {@link KILO_RESERVED_COMMAND_NAMES}). The name Kilo loads is the file
   * stem, and the processor calls this on the flattened path, so `goal.md`
   * is refused at any nesting depth under the basename naming and only at the
   * top level under the path naming, where `git/goal.md` becomes `git-goal`.
   * Import is untouched: a `goal.md` already in `.kilo/commands/` is read as
   * it is, since the reservation is Kilo's to enforce on its own files.
   */
  static getWriteBlockReason({
    rulesyncCommand,
  }: {
    rulesyncCommand: RulesyncCommand;
    global: boolean;
  }): string | null {
    const stem = basename(rulesyncCommand.getRelativeFilePath(), ".md");
    if (!KILO_RESERVED_COMMAND_NAMES.has(stem)) {
      return null;
    }
    return (
      `Kilo reserves the /${stem} command for session goals and refuses to load a ` +
      `custom command by that name — it would abort Kilo's whole command scan, ` +
      `making every other custom command unreachable too. Rename the command, ` +
      `or exclude it from this target with \`targets\`.`
    );
  }
}
