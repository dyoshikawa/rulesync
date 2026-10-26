import { z } from "zod/mini";

import { CURSOR_COMMANDS_DIR_PATH } from "../../constants/cursor-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  FrontmatterMarkdownToolCommand,
  type FrontmatterMarkdownToolCommandParams,
} from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const CursorCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  handoffs: z.optional(
    z.array(
      z.looseObject({
        label: z.string(),
        agent: z.optional(z.string()),
        prompt: z.optional(z.string()),
        send: z.optional(z.boolean()),
      }),
    ),
  ),
});

export type CursorCommandFrontmatter = z.infer<typeof CursorCommandFrontmatterSchema>;

export type CursorCommandParams = FrontmatterMarkdownToolCommandParams<CursorCommandFrontmatter>;

export class CursorCommand extends FrontmatterMarkdownToolCommand<CursorCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: CURSOR_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "cursor";
  }

  protected static override getFrontmatterSchema() {
    return CursorCommandFrontmatterSchema;
  }

  protected static override stringifyFileContent({
    body,
    frontmatter,
  }: {
    body: string;
    frontmatter: Record<string, unknown>;
  }): string {
    return stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true });
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): CursorCommandFrontmatter {
    // Merge cursor-specific fields from rulesync frontmatter
    const cursorFields = rulesyncFrontmatter.cursor ?? {};

    return {
      ...(rulesyncFrontmatter.description && { description: rulesyncFrontmatter.description }),
      ...cursorFields,
    };
  }

  protected static override getDeletionFrontmatter(): CursorCommandFrontmatter {
    return {};
  }
}
