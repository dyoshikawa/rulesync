import { join } from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { z } from "zod/mini";

import { TABNINE_COMMANDS_DIR_PATH } from "../../constants/tabnine-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const TabnineCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  prompt: z.string(),
});

/**
 * Translate rulesync universal command syntax (Claude Code compatible) into
 * Tabnine CLI's native syntax. See docs/reference/command-syntax.md. Tabnine
 * CLI is a Gemini CLI derivative and documents the same placeholders:
 * `{{args}}` for the user's arguments and `!{cmd}` for shell injection. Its
 * `@{path}` file-injection form has no universal counterpart and passes
 * through untouched in both directions.
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/commands
 *
 * Replacement order:
 *   1. `` !`cmd` `` → `!{cmd}`  (backtick shell expansion → brace form)
 *   2. `$ARGUMENTS` → `{{args}}` (handled after step 1 so that
 *      `` !`echo $ARGUMENTS` `` survives as `!{echo {{args}}}` rather than
 *      requiring two passes).
 *
 * `$ARGUMENTS\b` uses a trailing word boundary so `$ARGUMENTSx` and
 * `$ARGUMENTS_FOO` are left alone, while `$ARGUMENTS-foo` (hyphen is not a
 * word char) is rewritten. There is no leading anchor, so `prefix$ARGUMENTS`
 * is rewritten to `prefix{{args}}`.
 *
 * Bodies that already contain Tabnine-native forms (`{{args}}` or `!{cmd}`)
 * are left untouched, which gives us the documented "we do not re-translate
 * already-Tabnine-native forms" property.
 */
function translateRulesyncBodyToTabnine(body: string): string {
  return body.replace(/!`([^`\n]+)`/g, "!{$1}").replace(/\$ARGUMENTS\b/g, "{{args}}");
}

/**
 * Inverse of {@link translateRulesyncBodyToTabnine}, used when importing a
 * Tabnine CLI command file back into rulesync's universal syntax.
 *
 * Replacement order is intentionally inverted from the forward direction:
 *   1. `{{args}}` → `$ARGUMENTS` (handled first)
 *   2. `!{cmd}` → `` !`cmd` `` (handled second, with a non-greedy body
 *      `[^}\n]+?`)
 *
 * Doing `{{args}}` first ensures that nested forms like
 * `!{echo {{args}}}` round-trip back to `` !`echo $ARGUMENTS` `` in a single
 * pass: the inner `{{args}}` is rewritten to `$ARGUMENTS`, and then the
 * non-greedy `!{...}` match consumes the smallest possible body.
 */
function translateTabnineBodyToRulesync(body: string): string {
  return body.replace(/\{\{\s*args\s*\}\}/g, "$ARGUMENTS").replace(/!\{([^}\n]+?)\}/g, "!`$1`");
}

export type TabnineCommandFrontmatter = z.infer<typeof TabnineCommandFrontmatterSchema>;

/**
 * Tabnine CLI custom slash commands: TOML files with `description` and
 * `prompt` under `<project>/.tabnine/agent/commands/` (project) and
 * `~/.tabnine/agent/commands/` (user). The relative path names the command:
 * `review.toml` → `/review`, `code/review.toml` → `/code:review`.
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/commands
 */
export class TabnineCommand extends ToolCommand {
  private readonly frontmatter: TabnineCommandFrontmatter;
  private readonly body: string;

  constructor(params: AiFileParams) {
    super(params);
    const parsed = this.parseTomlContent(this.fileContent);
    this.frontmatter = parsed;
    this.body = parsed.prompt;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: TABNINE_COMMANDS_DIR_PATH,
    };
  }

  private parseTomlContent(content: string): TabnineCommandFrontmatter {
    try {
      const parsed = parseToml(content);
      const result = TabnineCommandFrontmatterSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
      // Preserve all fields including unknown ones (looseObject passthrough)
      return {
        ...result.data,
        description: result.data.description,
      };
    } catch (error) {
      throw new Error(
        `Failed to parse TOML command file (${join(this.relativeDirPath, this.relativeFilePath)}): ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return {
      description: this.frontmatter.description,
      prompt: this.frontmatter.prompt,
    };
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, prompt: _prompt, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["tabnine"],
      description: description,
      // Preserve extra fields in tabnine section (excluding prompt which is the body)
      ...(Object.keys(restFields).length > 0 && { tabnine: restFields }),
    };

    const universalBody = translateTabnineBodyToRulesync(this.body);

    // Generate proper file content with Rulesync specific frontmatter. The
    // `body` and `fileContent` fields below are derived from the same
    // `universalBody` source string, so they stay in sync — `body` is the
    // raw markdown content while `fileContent` is the same content wrapped
    // with YAML frontmatter for on-disk serialization.
    const fileContent = stringifyFrontmatter(universalBody, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: process.cwd(), // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: universalBody,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      // `.rulesync/commands/` holds Markdown, so `ns/name.toml` becomes `ns/name.md`.
      relativeFilePath: this.relativeFilePath.replace(/\.toml$/, ".md"),
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): TabnineCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge tabnine-specific fields from rulesync frontmatter
    const tabnineFields = rulesyncFrontmatter.tabnine ?? {};

    // Translate universal command syntax to Tabnine CLI's native syntax —
    // unless an explicit `tabnine.prompt` override is present, in which
    // case the user is hand-authoring the Tabnine-native body and we skip
    // translation entirely. Short-circuiting here avoids running the regex
    // pipeline only to discard its result via the spread below.
    const hasPromptOverride = typeof tabnineFields.prompt === "string";
    const translatedPrompt = hasPromptOverride
      ? ""
      : translateRulesyncBodyToTabnine(rulesyncCommand.getBody());

    const tabnineFrontmatter: TabnineCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      prompt: translatedPrompt,
      ...tabnineFields,
    };

    // Serialize via smol-toml's stringify so that special characters in the
    // description / prompt (`"`, `\`, control chars, embedded `"""`, etc.)
    // are properly escaped instead of breaking out of the TOML literal. The
    // serializer emits each value as a basic string with JSON-style escaping
    // — multi-line bodies are encoded with `\n` escape sequences, which
    // round-trip cleanly through `parseToml`.
    const tomlObject: Record<string, unknown> = {};
    if (tabnineFrontmatter.description !== undefined) {
      tomlObject.description = tabnineFrontmatter.description;
    }
    // Preserve the historical trailing-newline behavior of the prompt body.
    //
    // Before the migration to `stringifyToml`, the serializer wrote
    // `prompt = """\n${body}\n"""` — a multi-line basic string in which the
    // surrounding literal newlines are real bytes on disk, parsed back into
    // a single trailing `\n` by `parseToml`. Downstream code, snapshots, and
    // round-trip tests rely on that trailing newline being present in
    // `parsed.prompt`.
    //
    // The new `stringifyToml`-based serializer emits a basic single-line
    // string with `\n` escape sequences instead. The on-disk *shape* is
    // therefore different (no surrounding `"""`, escaped `\n` in place of
    // raw newline bytes), but the parsed-string equivalence is preserved by
    // unconditionally ensuring the in-memory value ends with `\n` before
    // serialization. This keeps the externally-observable contract stable.
    tomlObject.prompt = tabnineFrontmatter.prompt.endsWith("\n")
      ? tabnineFrontmatter.prompt
      : `${tabnineFrontmatter.prompt}\n`;
    // Note: TOML output only carries description and prompt. Extra fields
    // from the `tabnine` rulesync section are intentionally not serialized.
    const tomlContent = stringifyToml(tomlObject);

    const paths = this.getSettablePaths({ global });

    return new TabnineCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath().replace(/\.md$/, ".toml"),
      fileContent: tomlContent,
      validate,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<TabnineCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);

    return new TabnineCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    try {
      this.parseTomlContent(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "tabnine",
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): TabnineCommand {
    // Provide minimal valid TOML to pass constructor parsing.
    // The constructor always calls parseTomlContent(), so we need valid TOML even for deletion.
    const placeholderToml = `description = ""
prompt = ""`;
    return new TabnineCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: placeholderToml,
      validate: false,
    });
  }
}
