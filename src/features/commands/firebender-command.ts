import { z } from "zod/mini";

import { FIREBENDER_COMMANDS_DIR_PATH } from "../../constants/firebender-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * Frontmatter of a Firebender command. Every field is optional: `name`
 * defaults to the file name, `model` is `default`, `quick` or a model ID, and
 * `mode` is one of `auto`, `read`, `write` or `composer`. Unknown keys are
 * preserved.
 *
 * @see https://docs.firebender.com/api-reference/commands
 */
const FirebenderCommandFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  model: z.optional(z.string()),
  mode: z.optional(z.string()),
});

export type FirebenderCommandFrontmatter = z.infer<typeof FirebenderCommandFrontmatterSchema>;

const FIREBENDER_COMMAND_EXTENSION = ".mdc";

/**
 * Command generator for Firebender: one `.mdc` file per command under
 * `.firebender/commands/` (project) and `~/.firebender/commands/` (global),
 * with optional `name` / `description` / `model` / `mode` frontmatter. The
 * canonical `description` is written as is; `name`, `model` and `mode` come
 * from the `firebender:` section of the rulesync command.
 *
 * @see https://docs.firebender.com/api-reference/commands
 */
export class FirebenderCommand extends FrontmatterMarkdownToolCommand<FirebenderCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return {
      relativeDirPath: FIREBENDER_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "firebender";
  }

  protected static override getFrontmatterSchema() {
    return FirebenderCommandFrontmatterSchema;
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
  ): FirebenderCommandFrontmatter {
    const firebenderFields = rulesyncFrontmatter.firebender ?? {};
    return {
      ...(rulesyncFrontmatter.description && { description: rulesyncFrontmatter.description }),
      ...firebenderFields,
    };
  }

  protected static override toToolRelativeFilePath(rulesyncRelativeFilePath: string): string {
    return rulesyncRelativeFilePath.replace(/\.md$/, FIREBENDER_COMMAND_EXTENSION);
  }

  protected static override getDeletionFrontmatter(): FirebenderCommandFrontmatter {
    return {};
  }

  protected override toRulesyncRelativeFilePath(): string {
    return this.relativeFilePath.replace(/\.mdc$/, ".md");
  }
}
