import { join } from "node:path";

import { z } from "zod/mini";

import { CODEWHALE_COMMANDS_DIR_PATH } from "../../constants/codewhale-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
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
 * than as YAML: it splits each line at the first `:`, strips one matched pair
 * of outer quotes (except from `allowed-tools`) without unescaping anything,
 * and splits `allowed-tools` and `aliases` on commas. A YAML writer's quoting
 * would therefore leak into the values, and a valid Codewhale file need not be
 * valid YAML, so this adapter reads and writes that line format directly.
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
 * Project commands Codewhale refuses to load under these names (or aliases),
 * because they would stand in for a built-in that grants or revokes authority.
 * Built-in aliases of these commands are refused as well but not listed here.
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/commands/user_registry.rs
 */
// cspell:ignore jihua zidong
const CODEWHALE_PROTECTED_BUILTINS: ReadonlySet<string> = new Set([
  "auth",
  "auto",
  "config",
  "constitution",
  "hooks",
  "jihua",
  "login",
  "logout",
  "mcp",
  "mode",
  "network",
  "permissions",
  "plug",
  "plugin",
  "profile",
  "provider",
  "purge",
  "rc",
  "relay",
  "remote-env",
  "restore",
  "sessions",
  "settings",
  "setup",
  "share",
  "system",
  "trust",
  "undo",
  "update",
  "workspace",
  "zidong",
]);

/** A frontmatter key Codewhale's line parser reads back as the same key. */
const FRONTMATTER_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function isDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= 3 && /^-+$/.test(trimmed);
}

function stripMatchedQuotes(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse a command file the way Codewhale does (`parse_frontmatter` in
 * `user_commands.rs`): `key: value` lines between `---` delimiters, keys
 * lowercased, values trimmed and, except for `allowed-tools`, stripped of one
 * matched pair of outer quotes. Every value stays a string. A non-empty line
 * without a `:` ends the metadata of an unclosed block and starts the body.
 */
export function parseCodewhaleCommandFile(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const lines = content.split(/(?<=\n)/);
  if (!content.includes("\n") || !isDelimiterLine(lines[0] ?? "")) {
    return { frontmatter: {}, body: content };
  }
  const frontmatter: Record<string, string> = {};
  for (const [index, rawLine] of lines.slice(1).entries()) {
    const line = rawLine.replace(/\r?\n$/, "");
    if (isDelimiterLine(line)) {
      return {
        frontmatter,
        body: lines
          .slice(index + 2)
          .join("")
          .replace(/^[\r\n]+/, ""),
      };
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      if (line.trim().length > 0) {
        return {
          frontmatter,
          body: lines
            .slice(index + 1)
            .join("")
            .replace(/^[\r\n]+/, ""),
        };
      }
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const rawValue = line.slice(separator + 1).trim();
    if (key.length === 0 || PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    frontmatter[key] = key === "allowed-tools" ? rawValue : stripMatchedQuotes(rawValue);
  }
  return { frontmatter, body: "" };
}

/**
 * Write frontmatter as Codewhale's `key: value` lines. Each value is collapsed
 * to one line and written verbatim; a value that would itself look quoted is
 * wrapped in one more pair of double quotes, which Codewhale strips again.
 */
function stringifyCodewhaleCommandFile(body: string, frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    const text = String(value)
      .split(/\r\n|\r|\n/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(" ");
    const needsWrap = key !== "allowed-tools" && stripMatchedQuotes(text) !== text;
    lines.push(`${key}: ${needsWrap ? `"${text}"` : text}`);
  }
  const terminatedBody = body.endsWith("\n") ? body : `${body}\n`;
  // Without metadata the body is written alone, unless it opens with a
  // delimiter line that Codewhale would take for the start of frontmatter.
  if (lines.length === 0 && !isDelimiterLine(body.split("\n", 1)[0] ?? "")) {
    return terminatedBody;
  }
  return ["---", ...lines, "---", terminatedBody].join("\n");
}

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
    if (converted === undefined || !FRONTMATTER_KEY_PATTERN.test(key)) {
      droppedKeys.push(key);
    } else {
      fields[key] = converted;
    }
  }
  if (droppedKeys.length > 0) {
    logger?.warn(
      `Dropping codewhale command keys in ${relativeFilePath}: ${droppedKeys.join(", ")}. Codewhale reads command frontmatter as single-line key: value pairs, so only keys of letters, digits, "-" and "_" with a string, number, boolean or list-of-strings value are supported.`,
    );
  }
  return fields;
}

/**
 * Warn about command names Codewhale will not use: a frontmatter `name` that
 * is not one slash-command token (Codewhale falls back to the file stem with a
 * load error), and, for a project command, a name or alias that would take a
 * protected built-in (Codewhale skips the command or ignores the alias).
 */
function warnOnUnusableNames({
  frontmatter,
  relativeFilePath,
  global,
  logger,
}: {
  frontmatter: Record<string, unknown>;
  relativeFilePath: string;
  global: boolean;
  logger?: Logger;
}): void {
  const normalize = (name: string) => name.trim().replace(/^\/+/, "").toLowerCase();
  const stem = normalize(relativeFilePath.replace(/\.md$/, ""));
  let name = stem;
  if (frontmatter.name !== undefined) {
    const configured = String(frontmatter.name).trim().replace(/^\//, "");
    if (configured.length === 0 || /[\s/]/.test(configured)) {
      logger?.warn(
        `Codewhale rejects the name "${String(frontmatter.name)}" of the command ${relativeFilePath} (expected one slash-command token) and falls back to "/${stem}".`,
      );
    } else {
      name = configured.toLowerCase();
    }
  }
  if (global) return;
  if (CODEWHALE_PROTECTED_BUILTINS.has(name)) {
    logger?.warn(
      `Codewhale will not load the project command ${relativeFilePath}: "/${name}" is a protected built-in command. Rename it.`,
    );
  }
  // Codewhale assigns `alias` and `aliases` to the same list, so whichever
  // comes last in the frontmatter is the one it keeps.
  const aliasValue = Object.entries(frontmatter)
    .filter(([key]) => key === "alias" || key === "aliases")
    .at(-1)?.[1];
  const aliases = (typeof aliasValue === "string" ? aliasValue.split(",") : [])
    .map(normalize)
    .filter((alias) => CODEWHALE_PROTECTED_BUILTINS.has(alias));
  if (aliases.length > 0) {
    logger?.warn(
      `Codewhale ignores the aliases ${aliases.map((alias) => `"/${alias}"`).join(", ")} of the project command ${relativeFilePath}: they are protected built-in commands.`,
    );
  }
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
      fileContent: stringifyCodewhaleCommandFile(body, frontmatter),
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

    warnOnUnusableNames({
      frontmatter: codewhaleFrontmatter,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      global,
      logger,
    });

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
    const { frontmatter, body: content } = parseCodewhaleCommandFile(fileContent);

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
