import { join } from "node:path";

import { z } from "zod/mini";

import { CODEWHALE_COMMANDS_DIR_PATH } from "../../constants/codewhale-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * Codewhale user commands are Markdown files under `.codewhale/commands/`
 * (project scope, loaded only in a trusted workspace) and
 * `~/.codewhale/commands/` (user scope). The directory is scanned flat, and the
 * lowercased file stem is the slash-command name unless frontmatter `name`
 * replaces it. The documented frontmatter is `name`, `description`, `usage`,
 * `arguments`, `argument-hint`, `allowed-tools`, `pausable`,
 * `alias` / `aliases` and `hidden`; everything beyond `description`
 * round-trips through the `codewhale` section.
 *
 * Codewhale reads the frontmatter line by line as `key: value` pairs rather
 * than as YAML, and splits `allowed-tools` and `aliases` on commas. Generation
 * therefore writes every value on a single line and joins a list of strings
 * with `, `.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/architecture/command-dispatch.md
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/commands/user_commands.rs
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/commands/user_registry.rs
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const CodewhaleCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
});

export type CodewhaleCommandFrontmatter = z.infer<typeof CodewhaleCommandFrontmatterSchema>;

export type CodewhaleCommandParams = {
  frontmatter: CodewhaleCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Turn a `codewhale` section value into one Codewhale's line-based parser
 * reads back intact: scalars pass through and a list of strings is joined with
 * `, `. Anything else (a nested object, a mixed list) returns `undefined`.
 */
function toCodewhaleFrontmatterValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.join(", ");
  }
  return undefined;
}

function toCodewhaleSectionFields({
  section,
  relativeFilePath,
  logger,
}: {
  section: Record<string, unknown>;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(section)) {
    // The canonical description always wins over a stray same-named key.
    if (key === "description" || PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    const converted = toCodewhaleFrontmatterValue(value);
    if (converted === undefined) {
      droppedKeys.push(key);
    } else {
      fields[key] = converted;
    }
  }
  if (droppedKeys.length > 0) {
    logger?.warn(
      `Dropping codewhale command keys in ${relativeFilePath}: ${droppedKeys.join(", ")}. Codewhale reads command frontmatter as single-line key: value pairs, so only strings, numbers, booleans and lists of strings are supported.`,
    );
  }
  return fields;
}

export class CodewhaleCommand extends ToolCommand {
  private readonly frontmatter: CodewhaleCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CodewhaleCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = CodewhaleCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true }),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes use the same relative directory; the processor supplies the
    // home directory as outputRoot in global mode.
    return {
      relativeDirPath: CODEWHALE_COMMANDS_DIR_PATH,
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      // Preserve extra fields in the codewhale section
      ...(Object.keys(restFields).length > 0 && { codewhale: restFields }),
    };

    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
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
    logger,
  }: ToolCommandFromRulesyncCommandParams): CodewhaleCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const section = rulesyncFrontmatter.codewhale;

    const codewhaleFrontmatter: CodewhaleCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...(section !== null && typeof section === "object" && !Array.isArray(section)
        ? toCodewhaleSectionFields({
            section: section as Record<string, unknown>,
            relativeFilePath: rulesyncCommand.getRelativeFilePath(),
            logger,
          })
        : {}),
    };

    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new CodewhaleCommand({
      outputRoot,
      frontmatter: codewhaleFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CodewhaleCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "codewhale",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<CodewhaleCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = CodewhaleCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new CodewhaleCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): CodewhaleCommand {
    return new CodewhaleCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
