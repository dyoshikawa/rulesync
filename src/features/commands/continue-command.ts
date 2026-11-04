import { basename } from "node:path";

import { z } from "zod/mini";

import { CONTINUE_PROMPTS_DIR_PATH } from "../../constants/continue-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type {
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * Continue prompt files are Markdown files under `<project>/.continue/prompts/`
 * (project scope) and `~/.continue/prompts/` (user scope). A prompt with
 * `invokable: true` becomes a `/name` slash command in the chat input and the
 * CLI; without it the file is treated as a plain rule, so rulesync always sets
 * the flag. `name` is the command name (the file stem by default) and
 * `description` the hint shown next to it.
 *
 * @see https://docs.continue.dev/customize/deep-dives/prompts
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const ContinueCommandFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  invokable: z.optional(z.boolean()),
});

export type ContinueCommandFrontmatter = z.infer<typeof ContinueCommandFrontmatterSchema>;

/** The command name Continue derives from a prompt file: its stem. */
function commandNameFromFilePath(relativeFilePath: string): string {
  return basename(relativeFilePath).replace(/\.md$/, "");
}

export class ContinueCommand extends FrontmatterMarkdownToolCommand<ContinueCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes use the same relative directory; the processor supplies the
    // home directory as outputRoot in global mode.
    return {
      relativeDirPath: CONTINUE_PROMPTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "continue";
  }

  protected static override getFrontmatterSchema() {
    return ContinueCommandFrontmatterSchema;
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    // `invokable` is always re-emitted on generate and `name` defaults to the
    // file stem, so neither needs to round-trip unless `name` was customized.
    const { description, name, invokable: _invokable, ...restFields } = this.frontmatter;
    const continueFields: Record<string, unknown> = {
      ...(name !== undefined &&
        name !== commandNameFromFilePath(this.relativeFilePath) && { name }),
      ...restFields,
    };

    return {
      targets: ["*"],
      description,
      ...(Object.keys(continueFields).length > 0 && { continue: continueFields }),
    };
  }

  // The default `name` depends on the file path, which toToolFrontmatter does
  // not see, so the whole factory is overridden.
  static override fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): ContinueCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const relativeFilePath = rulesyncCommand.getRelativeFilePath();
    const continueFields = rulesyncFrontmatter.continue ?? {};

    const continueFrontmatter: ContinueCommandFrontmatter = {
      name: commandNameFromFilePath(relativeFilePath),
      description: rulesyncFrontmatter.description,
      ...continueFields,
      // Without the flag Continue reads the file as a rule, not a command.
      invokable: true,
    };

    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new this({
      outputRoot,
      frontmatter: continueFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }
}
