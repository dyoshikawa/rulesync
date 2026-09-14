import { join } from "node:path";

import { CONTINUE_MCP_DIR_PATH, CONTINUE_MCP_FILE_NAME } from "../../constants/continue-paths.js";
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
  splitLocalMcpCommand,
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

type ContinueMcpServers = Record<string, Record<string, unknown>>;

/**
 * Parse a Continue MCP file. Continue reads the files under `mcpServers/` as
 * JSONC, so comments and trailing commas in a hand-written file are accepted;
 * malformed content or a non-object root (`null`, an array, a scalar) fails
 * closed rather than being spread into the regenerated file.
 */
function parseContinueMcpConfig({
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
      `Failed to parse Continue MCP config at ${relativePath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse Continue MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

/**
 * The remote transport Continue reads a server as. Continue's JSON schema
 * accepts `type: "sse"` or `type: "http"` (streamable HTTP) for a `url`
 * server; a bare `url` defaults to `http`, and the canonical
 * `streamable-http` spelling is folded into it. A `ws(s)://` URL or any other
 * stated transport has no Continue equivalent, so `undefined` tells the
 * caller to skip the server.
 * @see https://docs.continue.dev/customize/deep-dives/mcp
 */
function asContinueRemoteType(stated: string | undefined, url: string): "http" | "sse" | undefined {
  if (stated === "sse") return "sse";
  if (stated === "http" || stated === "streamable-http") return "http";
  if (stated === undefined) {
    return /^wss?:\/\//i.test(url) ? undefined : "http";
  }
  return undefined;
}

/**
 * Convert the canonical server map to the shape Continue's JSON MCP schema
 * accepts: a remote server is `{ type, url, headers? }` and a stdio server is
 * `{ type: "stdio", command, args?, env? }`. Continue validates the whole
 * file with a strict union — one server that matches neither shape (an
 * unknown transport, a non-string `env` value) makes Continue drop every
 * server in the file — so only the documented keys are emitted and anything
 * else (`timeout`, `oauth`, rulesync-only fields) is left out. `envFile` is
 * accepted by Continue's schema but ignored with a warning at load time, so
 * it is dropped here with a warning instead of being written as if it worked.
 *
 * A server Continue cannot start or reach — no transport at all, a remote
 * transport without a URL, a WebSocket URL, or a stdio entry without a
 * command — is skipped with a warning rather than written in a form that
 * would invalidate the file.
 * @see https://docs.continue.dev/customize/deep-dives/mcp
 */
function convertToContinueFormat(mcpServers: McpServers, logger?: Logger): ContinueMcpServers {
  const result: ContinueMcpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    if (declaresNoTransport(serverConfig)) {
      warnAndSkipMcpServer({ toolName: "Continue", serverName, reason: "no transport", logger });
      continue;
    }

    const converted = isRemoteMcpServer(serverConfig)
      ? convertRemoteServer({ serverName, serverConfig, logger })
      : convertStdioServer({ serverName, serverConfig, logger });
    if (converted !== undefined) {
      result[serverName] = converted;
    }
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
      toolName: "Continue",
      serverName,
      reason: "a remote transport without a url",
      logger,
    });
    return undefined;
  }
  const stated = serverConfig.type ?? serverConfig.transport;
  const remoteType = asContinueRemoteType(typeof stated === "string" ? stated : undefined, url);
  if (remoteType === undefined) {
    warnAndSkipMcpServer({
      toolName: "Continue",
      serverName,
      reason:
        stated === undefined
          ? "a WebSocket url, which Continue's remote transports (http and sse) cannot reach"
          : `the "${String(stated)}" transport, which Continue does not offer for remote servers (only http and sse)`,
      logger,
    });
    return undefined;
  }
  const converted: Record<string, unknown> = { type: remoteType, url };
  if (isRecord(serverConfig.headers)) {
    converted.headers = omitPrototypePollutionKeys(serverConfig.headers);
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
  const [command, ...args] = splitLocalMcpCommand(serverConfig);
  if (!command) {
    warnAndSkipMcpServer({
      toolName: "Continue",
      serverName,
      reason: "a stdio transport without a command",
      logger,
    });
    return undefined;
  }
  const converted: Record<string, unknown> = { type: "stdio", command };
  if (args.length > 0) {
    converted.args = args;
  }
  if (isRecord(serverConfig.env)) {
    converted.env = omitPrototypePollutionKeys(serverConfig.env);
  }
  if (typeof serverConfig.envFile === "string") {
    // Continue parses `envFile` but never reads the file
    // (packages/config-yaml/src/schemas/mcp/convertJson.ts), so writing it
    // would only suggest that the variables are loaded when they are not.
    logger?.warn(
      `Continue ignores "envFile" for MCP servers, so the envFile of server "${serverName}" ` +
        `was not written; put the variables in "env" instead.`,
    );
  }
  return converted;
}

/**
 * Convert Continue's server map back to the canonical shape. The documented
 * spelling (`type` + `command`/`url`) is already canonical, so entries pass
 * through with only prototype-pollution keys dropped.
 */
function convertFromContinueFormat(mcpServers: unknown): McpServers {
  if (!isMcpServers(mcpServers)) {
    return {};
  }
  const result: McpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;
    result[serverName] = omitPrototypePollutionKeys(serverConfig);
  }

  return result;
}

/**
 * Continue MCP configuration.
 *
 * Continue loads every `*.json` file under `.continue/mcpServers/` (project)
 * and `~/.continue/mcpServers/` (global); rulesync owns one of them,
 * `mcp.json`, in the `{ "mcpServers": { ... } }` shape the docs show. Other
 * files in the directory, and top-level sibling keys of `mcp.json`, are left
 * alone. The global file is not deleted by `--delete` (it lives outside the
 * project), while the project file is rulesync's own and is.
 *
 * @see https://docs.continue.dev/customize/deep-dives/mcp
 */
export class ContinueMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent === undefined
        ? {}
        : parseContinueMcpConfig({
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // The same relative directory is used for both scopes; global mode only
    // changes the output root to the home directory.
    return {
      relativeDirPath: CONTINUE_MCP_DIR_PATH,
      relativeFilePath: CONTINUE_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ContinueMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';

    return new ContinueMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<ContinueMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    // Keep any top-level sibling keys of an existing file; only `mcpServers`
    // is regenerated.
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = parseContinueMcpConfig({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });

    // Use getMcpServers() (not getJson()) so rulesync-only fields are
    // stripped before writing the Continue config.
    const mcpServers = convertToContinueFormat(rulesyncMcp.getMcpServers(), logger);
    const continueConfig = { ...json, mcpServers };

    return new ContinueMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(continueConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromContinueFormat(this.json.mcpServers);
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
  }: ToolMcpForDeletionParams): ContinueMcp {
    return new ContinueMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
