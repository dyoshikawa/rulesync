import { basename, join } from "node:path";

import { z } from "zod/mini";

import {
  THEIA_PROMPT_TEMPLATE_EXTENSION,
  THEIA_PROMPTS_DIR_PATH,
} from "../../constants/theia-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type {
  ToolCommand,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * Frontmatter of a Theia AI prompt template. A template becomes a slash
 * command only with `isCommand: true`; `commandName` is what users type after
 * the slash, `commandDescription` is shown in the autocomplete list, and
 * `commandArgumentHint` / `commandAgents` are optional. Unknown keys are
 * preserved.
 *
 * @see https://theia-ide.org/docs/user_ai/#slash-commands
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/browser/prompttemplate-parser.ts
 */
const TheiaCommandFrontmatterSchema = z.looseObject({
  isCommand: z.optional(z.boolean()),
  commandName: z.optional(z.string()),
  commandDescription: z.optional(z.string()),
  commandArgumentHint: z.optional(z.string()),
  commandAgents: z.optional(z.array(z.string())),
});

export type TheiaCommandFrontmatter = z.infer<typeof TheiaCommandFrontmatterSchema>;

const TEMPLATE_EXTENSION_PATTERN = new RegExp(`\\.${THEIA_PROMPT_TEMPLATE_EXTENSION}$`);

/** The command name Theia shows for a template file: its file name stem. */
function templateStemOf(relativeFilePath: string): string {
  return basename(relativeFilePath).replace(TEMPLATE_EXTENSION_PATTERN, "").replace(/\.md$/, "");
}

/**
 * Command generator for Eclipse Theia AI: one `<name>.prompttemplate` file per
 * command in the workspace template directory `.prompts/`, with
 * `isCommand: true`, `commandName: <name>` and `commandDescription` from the
 * canonical `description`. `commandArgumentHint`, `commandAgents` and any other
 * key come from the `theia:` section of the rulesync command and win over the
 * generated ones. `$ARGUMENTS` and `$1`, `$2`, ... are Theia's own argument
 * placeholders, so the body is written as is.
 *
 * `.prompts/` also holds prompt fragments that are not commands (agent prompt
 * overrides, task contexts), so import reads only templates marked
 * `isCommand: true`, and the processor never sweeps the directory
 * (`committedOutput`).
 *
 * User-level template directories differ per Theia-based product and are not
 * documented, so only the project scope is supported.
 *
 * @see https://theia-ide.org/docs/user_ai/#slash-commands
 */
export class TheiaCommand extends FrontmatterMarkdownToolCommand<TheiaCommandFrontmatter> {
  static getSettablePaths(options: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (options.global) {
      throw new Error("TheiaCommand does not support global mode.");
    }
    return {
      relativeDirPath: THEIA_PROMPTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "theia";
  }

  protected static override getFrontmatterSchema() {
    return TheiaCommandFrontmatterSchema;
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): TheiaCommandFrontmatter {
    // `commandName` is filled in by `fromRulesyncCommand`, which knows the
    // file name; the `theia:` section spread last still wins over it.
    const theiaFields = rulesyncFrontmatter.theia ?? {};
    return {
      isCommand: true,
      ...(rulesyncFrontmatter.description && {
        commandDescription: rulesyncFrontmatter.description,
      }),
      ...theiaFields,
    };
  }

  static override fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): TheiaCommand {
    const relativeFilePath = this.toToolRelativeFilePath(rulesyncCommand.getRelativeFilePath());
    const frontmatter: TheiaCommandFrontmatter = {
      isCommand: true,
      commandName: templateStemOf(relativeFilePath),
      ...this.toToolFrontmatter(rulesyncCommand.getFrontmatter()),
    };
    const paths = this.getSettablePaths({ global });

    return new TheiaCommand({
      outputRoot,
      frontmatter,
      body: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  protected static override toToolRelativeFilePath(rulesyncRelativeFilePath: string): string {
    return rulesyncRelativeFilePath.replace(/\.md$/, `.${THEIA_PROMPT_TEMPLATE_EXTENSION}`);
  }

  protected static override getDeletionFrontmatter(): TheiaCommandFrontmatter {
    return {};
  }

  /**
   * Only templates Theia registers as slash commands are imported; the rest of
   * `.prompts/` is prompt fragments that are not commands.
   */
  static isImportable(toolCommand: ToolCommand): boolean {
    return toolCommand instanceof TheiaCommand && toolCommand.getFrontmatter().isCommand === true;
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    const {
      isCommand: _isCommand,
      commandName,
      commandDescription,
      ...restFields
    } = this.frontmatter;
    // `commandName` equal to the file name is what generation writes anyway;
    // any other name is kept so it round-trips.
    const theiaFields: Record<string, unknown> = {
      ...(commandName !== undefined &&
        commandName !== templateStemOf(this.relativeFilePath) && { commandName }),
      ...restFields,
    };

    return {
      targets: ["*"],
      ...(commandDescription !== undefined && { description: commandDescription }),
      ...(Object.keys(theiaFields).length > 0 && { theia: theiaFields }),
    };
  }

  protected override toRulesyncRelativeFilePath(): string {
    return this.relativeFilePath.replace(TEMPLATE_EXTENSION_PATTERN, ".md");
  }

  /**
   * Theia treats a template whose frontmatter does not parse as a plain
   * template (no command), so such a file is loaded as a non-command here too
   * instead of failing the whole import.
   */
  static override async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<TheiaCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    let frontmatter: TheiaCommandFrontmatter = {};
    let body = fileContent;
    try {
      const parsed = parseFrontmatter(fileContent, filePath);
      const result = TheiaCommandFrontmatterSchema.safeParse(parsed.frontmatter);
      if (result.success) {
        frontmatter = result.data;
        body = parsed.body;
      }
    } catch {
      // Not a command template; `isImportable()` leaves it out of the import.
    }

    return new TheiaCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter,
      body: body.trim(),
      validate,
    });
  }
}
