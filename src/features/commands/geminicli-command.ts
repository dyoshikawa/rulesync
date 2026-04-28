import { join } from "node:path";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { z } from "zod/mini";

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
export const GeminiCliCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  prompt: z.string(),
});

/**
 * Translate rulesync universal command syntax (Claude Code compatible) into
 * Gemini CLI's native syntax. See docs/reference/command-syntax.md.
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
 * Bodies that already contain Gemini-native forms (`{{args}}` or `!{cmd}`)
 * are left untouched, which gives us the documented "we do not re-translate
 * already-Gemini-native forms" property.
 */
function translateRulesyncBodyToGemini(body: string): string {
  return body.replace(/!`([^`\n]+)`/g, "!{$1}").replace(/\$ARGUMENTS\b/g, "{{args}}");
}

/**
 * Inverse of {@link translateRulesyncBodyToGemini}, used when importing a
 * Gemini CLI command file back into rulesync's universal syntax.
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
function translateGeminiBodyToRulesync(body: string): string {
  return body.replace(/\{\{\s*args\s*\}\}/g, "$ARGUMENTS").replace(/!\{([^}\n]+?)\}/g, "!`$1`");
}

export type GeminiCliCommandFrontmatter = z.infer<typeof GeminiCliCommandFrontmatterSchema>;

export type GeminiCliCommandParams = {
  frontmatter: GeminiCliCommandFrontmatter;
  body: string;
} & AiFileParams;

export class GeminiCliCommand extends ToolCommand {
  private readonly frontmatter: GeminiCliCommandFrontmatter;
  private readonly body: string;

  constructor(params: AiFileParams) {
    super(params);
    const parsed = this.parseTomlContent(this.fileContent);
    this.frontmatter = parsed;
    this.body = parsed.prompt;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".gemini", "commands"),
    };
  }

  private parseTomlContent(content: string): GeminiCliCommandFrontmatter {
    try {
      const parsed = parseToml(content);
      const result = GeminiCliCommandFrontmatterSchema.safeParse(parsed);
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
      targets: ["geminicli"],
      description: description,
      // Preserve extra fields in geminicli section (excluding prompt which is the body)
      ...(Object.keys(restFields).length > 0 && { geminicli: restFields }),
    };

    const universalBody = translateGeminiBodyToRulesync(this.body);

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
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): GeminiCliCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge geminicli-specific fields from rulesync frontmatter
    const geminicliFields = rulesyncFrontmatter.geminicli ?? {};

    // Translate universal command syntax to Gemini CLI's native syntax —
    // unless an explicit `geminicli.prompt` override is present, in which
    // case the user is hand-authoring the Gemini-native body and we skip
    // translation entirely. Short-circuiting here avoids running the regex
    // pipeline only to discard its result via the spread below.
    const hasPromptOverride = typeof geminicliFields.prompt === "string";
    const translatedPrompt = hasPromptOverride
      ? ""
      : translateRulesyncBodyToGemini(rulesyncCommand.getBody());

    const geminiFrontmatter: GeminiCliCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      prompt: translatedPrompt,
      ...geminicliFields,
    };

    // Serialize via smol-toml's stringify so that special characters in the
    // description / prompt (`"`, `\`, control chars, embedded `"""`, etc.)
    // are properly escaped instead of breaking out of the TOML literal. The
    // serializer emits each value as a basic string with JSON-style escaping
    // — multi-line bodies are encoded with `\n` escape sequences, which
    // round-trip cleanly through `parseToml`.
    const tomlObject: Record<string, unknown> = {};
    if (geminiFrontmatter.description !== undefined) {
      tomlObject.description = geminiFrontmatter.description;
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
    tomlObject.prompt = geminiFrontmatter.prompt.endsWith("\n")
      ? geminiFrontmatter.prompt
      : `${geminiFrontmatter.prompt}\n`;
    // Note: TOML output only carries description and prompt. Extra fields
    // from the `geminicli` rulesync section are intentionally not serialized.
    const tomlContent = stringifyToml(tomlObject);

    const paths = this.getSettablePaths({ global });

    return new GeminiCliCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath().replace(".md", ".toml"),
      fileContent: tomlContent,
      validate,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<GeminiCliCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);

    return new GeminiCliCommand({
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
      toolTarget: "geminicli",
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): GeminiCliCommand {
    // Provide minimal valid TOML to pass constructor parsing.
    // The constructor always calls parseTomlContent(), so we need valid TOML even for deletion.
    const placeholderToml = `description = ""
prompt = ""`;
    return new GeminiCliCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: placeholderToml,
      validate: false,
    });
  }
}
