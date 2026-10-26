import { z } from "zod/mini";

import { QWENCODE_COMMANDS_DIR_PATH } from "../../constants/qwencode-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  FrontmatterMarkdownToolCommand,
  type FrontmatterMarkdownToolCommandParams,
} from "./frontmatter-markdown-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const QwencodeCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  // Read by Qwen Code's FileCommandLoader alongside `description` (only
  // `description` is in the docs page, but all four are parsed): invocation
  // guidance, completion hint, and the model-invocation opt-out. Declared so
  // the surface is typed and validated like every peer command adapter.
  when_to_use: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
  "disable-model-invocation": z.optional(z.boolean()),
});

export type QwencodeCommandFrontmatter = z.infer<typeof QwencodeCommandFrontmatterSchema>;

export type QwencodeCommandParams =
  FrontmatterMarkdownToolCommandParams<QwencodeCommandFrontmatter>;

export class QwencodeCommand extends FrontmatterMarkdownToolCommand<QwencodeCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: QWENCODE_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "qwencode";
  }

  protected static override getFrontmatterSchema() {
    return QwencodeCommandFrontmatterSchema;
  }
}
