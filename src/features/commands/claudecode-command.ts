import { z } from "zod/mini";

import { CLAUDECODE_COMMANDS_DIR_PATH } from "../../constants/claudecode-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { ClaudecodeArgumentHintSchema } from "../shared/claudecode-argument-hint.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const ClaudecodeCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  // Removes the listed tools from the model while the command is active.
  // Accepts the space/comma-separated string form or a YAML list, mirroring `allowed-tools`.
  "disallowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  // A YAML list (the unquoted `[issue-number]` form) is joined back into the string form.
  "argument-hint": z.optional(ClaudecodeArgumentHintSchema),
  model: z.optional(z.string()),
  "disable-model-invocation": z.optional(z.boolean()),
});

export type ClaudecodeCommandFrontmatter = z.infer<typeof ClaudecodeCommandFrontmatterSchema>;

export class ClaudecodeCommand extends FrontmatterMarkdownToolCommand<ClaudecodeCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: CLAUDECODE_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "claudecode";
  }

  protected static override getFrontmatterSchema() {
    return ClaudecodeCommandFrontmatterSchema;
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    const { description, ...extraFields } = this.frontmatter;
    // A field the schema normalized away (an empty-list `argument-hint`) is left
    // as an undefined key; drop it so it does not produce an empty section.
    const restFields = Object.fromEntries(
      Object.entries(extraFields).filter(([, value]) => value !== undefined),
    );

    return {
      targets: ["*"],
      description,
      // Preserve extra fields in claudecode section
      ...(Object.keys(restFields).length > 0 && { claudecode: restFields }),
    };
  }
}
