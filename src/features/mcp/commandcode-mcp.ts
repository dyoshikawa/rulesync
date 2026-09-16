import { join } from "node:path";

import {
  COMMANDCODE_DIR,
  COMMANDCODE_GLOBAL_MCP_FILE_NAME,
  COMMANDCODE_PROJECT_MCP_FILE_NAME,
} from "../../constants/commandcode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  resolveLocalMcpCommand,
  resolveRemoteMcpUrl,
  warnAndSkipMcpServer,
} from "./mcp-transport.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

type CommandcodeMcpServers = Record<string, Record<string, unknown>>;

/**
 * Parse a Command Code MCP file. The project file is the `.mcp.json` other
 * agents (Claude Code among them) share, so a hand-written file is read as
 * JSONC to tolerate comments and trailing commas; malformed content or a
 * non-object root (`null`, an array, a scalar) fails closed rather than being
 * spread into the regenerated file.
 */
function parseCommandcodeMcpConfig({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseJsonc(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse Command Code MCP config at ${relativePath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse Command Code MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

/**
 * The remote transport Command Code reads a server as. Its loader accepts
 * `http` (streamable HTTP) and `sse` for a `url` server; a bare `url` defaults
 * to `http`, and the canonical `streamable-http` spelling is folded into it.
 * A `ws(s)://` URL or any other stated transport has no Command Code
 * equivalent, so `undefined` tells the caller to skip the server.
 * @see https://commandcode.ai/docs/mcp
 */
function asCommandcodeRemoteTransport(
  stated: string | undefined,
  url: string,
): "http" | "sse" | undefined {
  if (stated === "sse") return "sse";
  if (stated === "http" || stated === "streamable-http") return "http";
  if (stated === undefined) {
    return /^wss?:\/\//i.test(url) ? undefined : "http";
  }
  return undefined;
}

/**
 * Convert the canonical server map to the shape Command Code's config schema
 * documents (used for the global `~/.commandcode/mcp.json` only — the project
 * `.mcp.json` is shared with Claude Code and written pass-through, see the
 * class doc): a remote server is `{ transport, url, headers?, env?, oauth? }`
 * and a stdio server is `{ transport: "stdio", command, args?, env? }`, each
 * with an optional `enabled` flag. The documented spelling is `transport`
 * (`type` is only accepted as an alias on read), so that is what is written,
 * and only the documented keys are emitted — `timeout`, rulesync-only fields
 * and anything else is left out. The canonical `disabled: true` becomes
 * Command Code's native `enabled: false` (the rulesync-source-only `enabled`
 * filter never reaches this function: `getMcpServers()` drops such a server).
 *
 * A server Command Code drops at load time — no transport at all, a remote
 * transport without a URL, a WebSocket URL, or a stdio entry without a
 * command — is skipped with a warning rather than written in a form the tool
 * would silently ignore.
 * @see https://commandcode.ai/docs/mcp
 */
function convertToCommandcodeFormat(
  mcpServers: McpServers,
  logger?: Logger,
): CommandcodeMcpServers {
  const result: CommandcodeMcpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    if (declaresNoTransport(serverConfig)) {
      warnAndSkipMcpServer({
        toolName: "Command Code",
        serverName,
        reason: "no transport",
        logger,
      });
      continue;
    }

    const converted = isRemoteMcpServer(serverConfig)
      ? convertRemoteServer({ serverName, serverConfig, logger })
      : convertStdioServer({ serverName, serverConfig, logger });
    if (converted === undefined) continue;
    if (serverConfig.disabled === true) {
      converted.enabled = false;
    }
    if (isRecord(serverConfig.env)) {
      converted.env = omitPrototypePollutionKeys(serverConfig.env);
    }
    result[serverName] = converted;
  }

  return result;
}

function convertRemoteServer({
  serverName,
  serverConfig,
  logger,
}: {
  serverName: string;
  serverConfig: Record<string, unknown>;
  logger?: Logger;
}): Record<string, unknown> | undefined {
  const url = resolveRemoteMcpUrl(serverConfig);
  if (!url) {
    warnAndSkipMcpServer({
      toolName: "Command Code",
      serverName,
      reason: "a remote transport without a url",
      logger,
    });
    return undefined;
  }
  const stated = serverConfig.type ?? serverConfig.transport;
  const transport = asCommandcodeRemoteTransport(
    typeof stated === "string" ? stated : undefined,
    url,
  );
  if (transport === undefined) {
    warnAndSkipMcpServer({
      toolName: "Command Code",
      serverName,
      reason:
        stated === undefined
          ? "a WebSocket url, which Command Code's remote transports (http and sse) cannot reach"
          : `the "${String(stated)}" transport, which Command Code does not offer for remote servers (only http and sse)`,
      logger,
    });
    return undefined;
  }
  const converted: Record<string, unknown> = { transport, url };
  if (isRecord(serverConfig.headers)) {
    converted.headers = omitPrototypePollutionKeys(serverConfig.headers);
  }
  if (isRecord(serverConfig.oauth)) {
    converted.oauth = omitPrototypePollutionKeys(serverConfig.oauth);
  }
  return converted;
}

function convertStdioServer({
  serverName,
  serverConfig,
  logger,
}: {
  serverName: string;
  serverConfig: Record<string, unknown>;
  logger?: Logger;
}): Record<string, unknown> | undefined {
  const [command, ...args] = resolveLocalMcpCommand(serverConfig);
  if (!command) {
    warnAndSkipMcpServer({
      toolName: "Command Code",
      serverName,
      reason: "a stdio transport without a command",
      logger,
    });
    return undefined;
  }
  const converted: Record<string, unknown> = { transport: "stdio", command };
  if (args.length > 0) {
    converted.args = args;
  }
  return converted;
}

/**
 * Convert Command Code's server map back to the canonical shape. Both
 * spellings Command Code accepts (`transport` and its `type` alias, with
 * `command`/`url`) are already canonical, so entries pass through with only
 * prototype-pollution keys dropped; the native `enabled: false` maps to the
 * canonical `disabled: true` (a bare `enabled` would otherwise be read back
 * as rulesync's own generation filter and silently drop the server from every
 * other target).
 */
function convertFromCommandcodeFormat(mcpServers: unknown): McpServers {
  if (!isMcpServers(mcpServers)) {
    return {};
  }
  const result: McpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;
    const { enabled, ...rest } = omitPrototypePollutionKeys(serverConfig);
    result[serverName] = enabled === false ? { ...rest, disabled: true } : rest;
  }

  return result;
}

/**
 * Command Code MCP configuration.
 *
 * Command Code reads `.mcp.json` at the project root (project scope, meant to
 * be committed) and `~/.commandcode/mcp.json` (user scope), both in the
 * `{ "mcpServers": { ... } }` shape the docs show; the per-machine local
 * scope under `~/.commandcode/projects/` is left to the tool. Top-level
 * sibling keys of an existing file are kept. The global file is not deleted
 * by `--delete` (it lives outside the project), while the project file is
 * rulesync's own and is.
 *
 * The project `.mcp.json` is the very file the `claudecode` target writes, so
 * at project scope the servers are written in the same pass-through shape
 * `ClaudecodeMcp` uses: whichever of the two targets generates last leaves
 * byte-identical content, and Command Code reads that shape natively (`type`
 * is an alias of `transport`, a bare `url` infers `http`, and unknown keys
 * are ignored). Only the global file — Command Code's own — gets the
 * `transport` / `enabled: false` rewrite of `convertToCommandcodeFormat`.
 *
 * @see https://commandcode.ai/docs/mcp
 */
export class CommandcodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent === undefined
        ? {}
        : parseCommandcodeMcpConfig({
            fileContent: this.fileContent,
            relativePath: join(this.relativeDirPath, this.relativeFilePath),
          });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Project: `<project>/.mcp.json`; global: `~/.commandcode/mcp.json` (the
    // processor supplies the home directory as outputRoot in global mode).
    return global
      ? { relativeDirPath: COMMANDCODE_DIR, relativeFilePath: COMMANDCODE_GLOBAL_MCP_FILE_NAME }
      : { relativeDirPath: ".", relativeFilePath: COMMANDCODE_PROJECT_MCP_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CommandcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';

    return new CommandcodeMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CommandcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    // Keep any top-level sibling keys of an existing file; only `mcpServers`
    // is regenerated. The project file is shared with other agents that read
    // `.mcp.json`, so nothing beyond that key is touched.
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = parseCommandcodeMcpConfig({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });

    // Use getMcpServers() (not getJson()) so rulesync-only fields are
    // stripped before writing the Command Code config. The project file is
    // shared with the `claudecode` target and must come out identical from
    // both, so only the global file is rewritten into Command Code's own
    // documented spelling (see the class doc).
    const mcpServers = global
      ? convertToCommandcodeFormat(rulesyncMcp.getMcpServers(), logger)
      : rulesyncMcp.getMcpServers();
    const commandcodeConfig = { ...json, mcpServers };

    return new CommandcodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(commandcodeConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromCommandcodeFormat(this.json.mcpServers);
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
  }: ToolMcpForDeletionParams): CommandcodeMcp {
    return new CommandcodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
