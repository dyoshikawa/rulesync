import { z } from "zod/mini";

import { COPILOT_PROMPTS_DIR_PATH } from "../../constants/copilot-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const CopilotCommandFrontmatterSchema = z.looseObject({
  // `agent` is the current VS Code prompt-file field (values `ask` | `agent` |
  // `plan` | a custom agent name). See
  // https://code.visualstudio.com/docs/copilot/customization/prompt-files
  agent: z.optional(z.string()),
  // `mode` is the deprecated predecessor of `agent`; still accepted for
  // backward compatibility and migrated to `agent` on import.
  mode: z.optional(z.string()),
  description: z.optional(z.string()),
});

export type CopilotCommandFrontmatter = z.infer<typeof CopilotCommandFrontmatterSchema>;

export class CopilotCommand extends FrontmatterMarkdownToolCommand<CopilotCommandFrontmatter> {
  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: COPILOT_PROMPTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "copilot";
  }

  protected static override getFrontmatterSchema() {
    return CopilotCommandFrontmatterSchema;
  }

  // Change file extension from .md to .prompt.md
  protected static override toToolRelativeFilePath(rulesyncRelativeFilePath: string): string {
    return rulesyncRelativeFilePath.replace(/\.md$/, ".prompt.md");
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    const { mode, agent, description, ...restFields } = this.frontmatter;

    // Migrate the deprecated `mode` field to `agent`. If both are present, the
    // explicit `agent` value wins.
    const resolvedAgent = agent ?? mode;

    const copilotFields = {
      ...restFields,
      ...(resolvedAgent !== undefined && { agent: resolvedAgent }),
    };

    return {
      targets: ["*"],
      description,
      // Preserve extra copilot-specific fields (including the normalized `agent`;
      // the deprecated `mode` is dropped in favor of `agent`).
      ...(Object.keys(copilotFields).length > 0 && { copilot: copilotFields }),
    };
  }

  protected override getRulesyncOutputRoot(): string {
    return this.outputRoot;
  }

  // Strip .prompt.md extension and normalize to .md
  protected override toRulesyncRelativeFilePath(): string {
    return this.relativeFilePath.replace(/\.prompt\.md$/, ".md");
  }
}
