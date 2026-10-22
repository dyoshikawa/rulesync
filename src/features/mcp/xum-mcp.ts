import { join } from "node:path";

import { XUM_DIR, XUM_MCP_FILE_NAME } from "../../constants/xum-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import type { McpServer, McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isPlainObject, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const EMPTY_XUM_MCP_CONFIG = JSON.stringify({ servers: {} }, null, 2);

/** Characters that never need quoting in a POSIX shell word. */
const SHELL_SAFE_WORD = /^[A-Za-z0-9_\-.,:/@%+=]+$/;

/**
 * A command string free of quotes, escapes, expansions and operators, which
 * can be split on whitespace back into argv without changing its meaning.
 */
const SPLIT_SAFE_COMMAND = /^[^'"\\$`|&;<>(){}*?[\]~#!\n]+$/;

/** Single-quote one argv element for the POSIX shell Xum runs commands in. */
function quoteShellWord(value: string): string {
  if (SHELL_SAFE_WORD.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Build the shell command string a Xum stdio server is launched with. A
 * `command` string is kept verbatim (Xum itself treats it as a raw shell
 * string, so `npx -y pkg` authored as one string keeps working); an explicit
 * argv (`command` as an array) and every `args` element are quoted where
 * needed, so `/opt/my tools/srv` stays one word.
 */
function buildCommandString(server: McpServer): string | undefined {
  const args = server.args ?? [];
  if (Array.isArray(server.command)) {
    const [executable] = server.command;
    if (executable === undefined || executable.trim() === "") return undefined;
    return [...server.command, ...args].map(quoteShellWord).join(" ");
  }
  if (typeof server.command !== "string" || server.command.trim() === "") return undefined;
  return [server.command, ...args.map(quoteShellWord)].join(" ");
}

/** A name bash accepts on the left of a `NAME=value` assignment. */
const SHELL_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A canonical `${VAR}` reference whose name bash can expand. */
const ENV_VAR_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Quote an env value for a `NAME=value` assignment. Literal text is
 * single-quoted, so nothing in it is expanded or run, while every canonical
 * `${VAR}` reference is emitted as `"${VAR}"` so bash still expands it from
 * the environment Xum starts the server with. The pieces are concatenated into
 * one shell word: `Bearer ${TOKEN}` becomes `'Bearer '"${TOKEN}"`.
 */
function quoteEnvValue(value: string): string {
  if (value === "") return "''";
  const parts: string[] = [];
  let last = 0;
  for (const match of value.matchAll(ENV_VAR_REFERENCE)) {
    if (match.index > last) parts.push(quoteShellWord(value.slice(last, match.index)));
    parts.push(`"\${${match[1]}}"`);
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push(quoteShellWord(value.slice(last)));
  return parts.join("");
}

/**
 * Build the `NAME=value ` prefix that sets a stdio server's `env` for its
 * command only (Xum runs the command string with bash). Returns the prefix
 * plus the entries left out: names that cannot be bash assignment targets and
 * entries whose value is not a string.
 */
function buildEnvPrefix(env: Record<string, unknown>): {
  prefix: string;
  invalidNames: string[];
  nonStringNames: string[];
} {
  const assignments: string[] = [];
  const invalidNames: string[] = [];
  const nonStringNames: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (!SHELL_ENV_NAME.test(name)) {
      invalidNames.push(name);
      continue;
    }
    if (typeof value !== "string") {
      nonStringNames.push(name);
      continue;
    }
    assignments.push(`${name}=${quoteEnvValue(value)}`);
  }
  return {
    prefix: assignments.map((assignment) => `${assignment} `).join(""),
    invalidNames,
    nonStringNames,
  };
}

// cspell:ignore coproc -- a bash reserved word
/** Bash reserved words; a command starting with one cannot take an assignment prefix. */
const BASH_RESERVED_WORDS = new Set([
  "!",
  "[[",
  "]]",
  "{",
  "}",
  "case",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "time",
  "until",
  "while",
]);

/**
 * Explain why a `NAME=value` prefix would not reach the server, or return
 * `undefined` when it would. Bash applies such assignments to the first simple
 * command only: with a list or pipeline (`cd x && srv`) the server would not
 * see them, and in front of a group, parenthesized list or reserved word (`( srv )`,
 * `{ srv; }`, `if ...`) they are a syntax error that keeps the server from
 * starting. Only the verbatim `command` string is checked for operators;
 * argv elements are quoted by {@link quoteShellWord}.
 */
function envPrefixBlocker(server: McpServer, baseCommand: string): string | undefined {
  if (typeof server.command === "string" && /[;&|(){}\n]/.test(server.command)) {
    return "its command string contains shell operators, grouping or a newline, so bash would not pass NAME=value assignments in front of it to the server";
  }
  const [firstWord] = baseCommand.trimStart().split(/\s+/);
  if (firstWord !== undefined && BASH_RESERVED_WORDS.has(firstWord)) {
    return `its command starts with the bash reserved word ${quoteValueForWarning(firstWord)}, which cannot follow NAME=value assignments`;
  }
  return undefined;
}

/**
 * One leading `NAME=value` assignment in exactly the shape {@link quoteEnvValue}
 * writes: bare shell-safe characters, single-quoted text (with the `'\''`
 * escape) and `"${VAR}"` references, followed by spaces or tabs (a newline
 * would end the command, so the assignment would not apply to what follows). Bare characters
 * are matched one at a time, so every alternative starts with a distinct
 * character and the pattern cannot backtrack exponentially.
 */
const LEADING_ENV_ASSIGNMENT =
  /^([A-Za-z_][A-Za-z0-9_]*)=((?:[A-Za-z0-9_\-.,:/@%+=]|'[^']*'|\\'|"\$\{[A-Za-z_][A-Za-z0-9_]*\}")*)[ \t]+/;

/** Decode a value written by {@link quoteEnvValue} back into its canonical form. */
function unquoteEnvValue(quoted: string): string {
  return quoted.replace(/'([^']*)'|\\'|"(\$\{[A-Za-z_][A-Za-z0-9_]*\})"/g, (_m, single, ref) =>
    typeof single === "string" ? single : typeof ref === "string" ? ref : "'",
  );
}

/**
 * Split leading `NAME=value` assignments off a command string, but only when
 * every one of them is in the shape rulesync writes and a plain command
 * follows (see {@link envPrefixBlocker}); anything else (for example a `$(...)` substitution) keeps the whole string as
 * the command.
 */
function splitEnvPrefix(command: string): { env?: Record<string, string>; rest: string } {
  const env: Record<string, string> = {};
  let rest = command.trimStart();
  for (;;) {
    const match = LEADING_ENV_ASSIGNMENT.exec(rest);
    if (match === null) break;
    const [whole, name, quoted] = match;
    if (name === undefined || quoted === undefined || PROTOTYPE_POLLUTION_KEYS.has(name)) break;
    env[name] = unquoteEnvValue(quoted);
    rest = rest.slice(whole.length);
  }
  if (
    Object.keys(env).length === 0 ||
    rest.trim() === "" ||
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest) ||
    // The assignments would not reach the whole command (or are a syntax
    // error), and the writer never emits such a prefix, so keep it as authored.
    envPrefixBlocker({ command: rest }, rest) !== undefined
  ) {
    return { rest: command };
  }
  return { env, rest };
}

/** Read a command string back into `env` + `command` + `args`. */
function parseCommandString(command: string): Pick<McpServer, "command" | "args" | "env"> {
  const { env, rest } = splitEnvPrefix(command);
  return { ...(env !== undefined && { env }), ...splitCommandString(rest) };
}

/** Split a plain command string back into `command` + `args` when it is safe to. */
function splitCommandString(command: string): Pick<McpServer, "command" | "args"> {
  const trimmed = command.trim();
  if (!SPLIT_SAFE_COMMAND.test(trimmed)) return { command };
  const [head, ...rest] = trimmed.split(/\s+/);
  if (head === undefined) return { command };
  return rest.length > 0 ? { command: head, args: rest } : { command: head };
}

type XumServerKind = "stdio" | "http" | "sse" | "auto";

function resolveXumServerKind(
  server: McpServer,
): XumServerKind | { unsupported: string } | undefined {
  const candidate = server.type ?? server.transport;
  if (candidate === "stdio" || candidate === "local") return "stdio";
  if (candidate === "http" || candidate === "streamable-http") return "http";
  if (candidate === "sse") return "sse";
  if (candidate !== undefined) return { unsupported: candidate };
  if (server.command !== undefined) return "stdio";
  const url = server.url ?? server.httpUrl;
  if (typeof url === "string") {
    return /^wss?:\/\//i.test(url) ? { unsupported: "ws" } : "auto";
  }
  return undefined;
}

/** Convert one canonical server into a Xum `servers` entry, or `null` to skip it. */
function convertServerToXum({
  name,
  server,
  logger,
}: {
  name: string;
  server: McpServer;
  logger?: Logger;
}): unknown {
  const skip = (reason: string): null => {
    warnWithFallback(logger, `Xum MCP: skipping ${quoteValueForWarning(name)} because ${reason}.`);
    return null;
  };
  const kind = resolveXumServerKind(server);
  if (kind === undefined) return skip("it has neither a command nor a URL");
  if (typeof kind === "object") {
    return skip(
      `it uses the "${kind.unsupported}" transport, which Xum does not support (only stdio, http and sse)`,
    );
  }

  const settings: Record<string, unknown> = {};
  if (server.disabled === true) settings.disabled = true;
  if (isStringArray(server.enabledTools)) settings.toolAllowlist = server.enabledTools;

  if (kind !== "stdio") {
    const url = server.url ?? server.httpUrl;
    if (typeof url !== "string" || url === "") return skip("it has no URL");
    return {
      ...(kind !== "auto" && { transport: kind }),
      url,
      ...(isPlainObject(server.headers) &&
        Object.keys(server.headers).length > 0 && { headers: server.headers }),
      ...settings,
    };
  }

  const baseCommand = buildCommandString(server);
  if (baseCommand === undefined) return skip("it has no command");
  // Xum runs the command string with bash, so `env` becomes `NAME=value`
  // assignments in front of it, which set each variable for this command only.
  let command = baseCommand;
  if (isPlainObject(server.env) && Object.keys(server.env).length > 0) {
    const blocker = envPrefixBlocker(server, baseCommand);
    if (blocker !== undefined) {
      warnWithFallback(
        logger,
        `Xum MCP: ${quoteValueForWarning(name)} sets env, but ${blocker}; the server is written without env.`,
      );
    } else {
      const { prefix, invalidNames, nonStringNames } = buildEnvPrefix(server.env);
      command = `${prefix}${baseCommand}`;
      if (invalidNames.length > 0) {
        warnWithFallback(
          logger,
          `Xum MCP: ${quoteValueForWarning(name)} sets env ${invalidNames.map(quoteValueForWarning).join(", ")}, ` +
            `which cannot be a bash variable name; the server is written without it.`,
        );
      }
      if (nonStringNames.length > 0) {
        warnWithFallback(
          logger,
          `Xum MCP: ${quoteValueForWarning(name)} sets env ${nonStringNames.map(quoteValueForWarning).join(", ")} ` +
            `to a value that is not a string; the server is written without it.`,
        );
      }
    }
  }
  if (typeof server.cwd === "string") {
    warnWithFallback(
      logger,
      `Xum MCP: ${quoteValueForWarning(name)} sets cwd, which Xum's mcp.jsonc cannot express; ` +
        `the server is written without it (Xum starts stdio servers in the workspace directory).`,
    );
  }
  return Object.keys(settings).length > 0 ? { command, ...settings } : command;
}

/** Copy only the string values of a header map (secret references have no canonical form). */
function copyStringHeaders(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!PROTOTYPE_POLLUTION_KEYS.has(key) && typeof entry === "string") result[key] = entry;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Read a Xum `servers` map back into the canonical shape. */
function convertFromXumFormat(servers: unknown): McpServers {
  if (!isPlainObject(servers)) return {};
  const result: McpServers = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (typeof entry === "string") {
      result[name] = parseCommandString(entry);
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const server: McpServer = {};
    if (typeof entry.url === "string") {
      if (entry.transport === "http" || entry.transport === "sse") server.type = entry.transport;
      server.url = entry.url;
      const headers = copyStringHeaders(entry.headers);
      if (headers !== undefined) server.headers = headers;
    } else if (typeof entry.command === "string") {
      Object.assign(server, parseCommandString(entry.command));
    } else {
      continue;
    }
    if (entry.disabled === true) server.disabled = true;
    if (isStringArray(entry.toolAllowlist)) server.enabledTools = entry.toolAllowlist;
    result[name] = server;
  }
  return result;
}

/**
 * Xum MCP configuration.
 *
 * Xum reads `~/.xum/mcp.jsonc` (user) and the repo override `.xum/mcp.jsonc`
 * (project; a server there wins over the user one of the same name). Both are
 * a JSONC document with a `servers` map:
 *
 * - a stdio server is a shell command string run with bash (the object form
 *   `{ command }` carries `disabled` / `toolAllowlist`); `env` is written as
 *   `NAME=value` assignments in front of the command, and `cwd`, which has no
 *   equivalent, is dropped with a warning;
 * - a remote server is `{ transport: "http" | "sse" | "auto", url, headers }`
 *   (the transport defaults to auto-detection).
 *
 * rulesync owns only `servers`; other top-level keys (Xum writes
 * `enabledPluginServers` into the user file) are preserved. The project file
 * may be removed by `--delete`; the user file never is.
 *
 * @see https://xum.cdr.dev/config/mcp-servers
 * @see https://github.com/coder/xum/blob/main/src/node/services/mcpConfigService.ts
 */
export class XumMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseSharedConfig({
      format: "jsonc",
      fileContent: this.fileContent,
      filePath: join(this.relativeDirPath, this.relativeFilePath),
      invalidRootPolicy: "error",
      jsoncParseErrors: "error",
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: XUM_DIR, relativeFilePath: XUM_MCP_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<XumMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? EMPTY_XUM_MCP_CONFIG;

    return new XumMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<XumMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? EMPTY_XUM_MCP_CONFIG;

    const servers: Record<string, unknown> = {};
    for (const [name, server] of Object.entries(rulesyncMcp.getMcpServers())) {
      if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
      const entry = convertServerToXum({ name, server, logger });
      if (entry !== null) servers[name] = entry;
    }

    return new XumMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: { servers },
        filePath,
        logger,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromXumFormat(this.json.servers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): XumMcp {
    return new XumMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
