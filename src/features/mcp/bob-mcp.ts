import { join } from "node:path";

import { BOB_DIR, BOB_MCP_FILE_NAME } from "../../constants/bob-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
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

type BobMcpServers = Record<string, Record<string, unknown>>;

/**
 * Parse a Bob MCP file, failing closed on malformed JSON or a non-object root
 * (`null`, an array, a scalar) rather than spreading whatever came back into
 * the regenerated file.
 */
function parseBobMcpConfig({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Bob MCP config at ${relativePath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse Bob MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

/** The `type` Bob IDE writes for a streamable HTTP server. */
const BOB_STREAMABLE_HTTP_TYPE = "streamable-http";

/**
 * The remote transport Bob IDE reads a server as, spelled the way it writes
 * it: `streamable-http` needs an explicit `type`, while SSE (legacy) is a bare
 * `url` with no `type`. `http` is the canonical rulesync alias for streamable
 * HTTP and a bare `url` defaults to it, streamable HTTP being the current MCP
 * transport. A `ws(s)://` URL or any other stated transport is something Bob
 * cannot reach, so `undefined` tells the caller to skip the server.
 * @see https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob
 */
function asBobRemoteType(
  stated: string | undefined,
  url: string,
): "streamable-http" | "sse" | undefined {
  if (stated === "sse") return "sse";
  if (stated === "http" || stated === BOB_STREAMABLE_HTTP_TYPE) return BOB_STREAMABLE_HTTP_TYPE;
  if (stated === undefined) {
    return /^wss?:\/\//i.test(url) ? undefined : BOB_STREAMABLE_HTTP_TYPE;
  }
  return undefined;
}

/**
 * Convert the canonical server map to the shape Bob IDE documents for
 * `.bob/mcp.json`: a stdio server carries `command` (plus `args`), a
 * streamable HTTP server carries `type: "streamable-http"` and `url`, and an
 * SSE server carries a bare `url`. The canonical `transport` alias and the
 * Claude-style `httpUrl` alias are folded into `type`/`url`; `env`, `cwd`,
 * `headers`, `timeout`, `alwaysAllow` and `disabled` pass through, as Bob
 * documents all of them (`env` and `headers` with their prototype-pollution
 * keys dropped, since Bob spreads those maps into the process environment and
 * the HTTP requests).
 *
 * Bob Shell documents the same file with an `httpURL` key instead of
 * `type` + `url` for streamable HTTP. rulesync writes the IDE spelling (the two
 * products share the project file, and the IDE is the one whose global file
 * rulesync targets) and accepts the Shell spelling on import.
 *
 * A server Bob cannot start or reach — no transport at all, a remote transport
 * without a URL, a WebSocket URL, or a stdio entry without a command — is
 * skipped with a warning rather than written in a broken form.
 * @see https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob
 * @see https://bob.ibm.com/docs/shell/configuration/mcp/mcp-bobshell
 */
function convertToBobFormat(mcpServers: McpServers, logger?: Logger): BobMcpServers {
  const result: BobMcpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    if (declaresNoTransport(serverConfig)) {
      warnAndSkipMcpServer({ toolName: "Bob", serverName, reason: "no transport", logger });
      continue;
    }

    const {
      type,
      transport,
      url: _url,
      httpUrl: _httpUrl,
      command: _command,
      args: _args,
      ...rest
    } = serverConfig;
    const converted: Record<string, unknown> = {};

    if (isRemoteMcpServer(serverConfig)) {
      const url = resolveRemoteMcpUrl(serverConfig);
      if (!url) {
        warnAndSkipMcpServer({
          toolName: "Bob",
          serverName,
          reason: "a remote transport without a url",
          logger,
        });
        continue;
      }
      const stated = type ?? transport;
      const remoteType = asBobRemoteType(stated, url);
      if (remoteType === undefined) {
        warnAndSkipMcpServer({
          toolName: "Bob",
          serverName,
          reason:
            stated === undefined
              ? "a WebSocket url, which Bob's remote transports (streamable-http and sse) cannot reach"
              : `the "${stated}" transport, which Bob does not offer for remote servers (only streamable-http and sse)`,
          logger,
        });
        continue;
      }
      if (remoteType === BOB_STREAMABLE_HTTP_TYPE) {
        converted.type = BOB_STREAMABLE_HTTP_TYPE;
      }
      converted.url = url;
    } else {
      const [command, ...args] = splitLocalMcpCommand(serverConfig);
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "Bob",
          serverName,
          reason: "a stdio transport without a command",
          logger,
        });
        continue;
      }
      converted.command = command;
      if (args.length > 0) {
        converted.args = args;
      }
    }

    for (const [key, value] of Object.entries(rest)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      // `env` and `headers` are key/value maps Bob spreads into the server's
      // process environment and HTTP requests, so their keys are sanitized too.
      converted[key] =
        (key === "env" || key === "headers") && isRecord(value)
          ? omitPrototypePollutionKeys(value)
          : value;
    }
    result[serverName] = converted;
  }

  return result;
}

/**
 * Convert Bob's server map back to the canonical shape. The IDE spelling
 * (`type: "streamable-http"` + `url`) is already canonical and passes through;
 * the Bob Shell spelling `httpURL` becomes `url` with `type: "http"`; a bare
 * `url` is an SSE server in Bob, so it gains `type: "sse"` to keep that reading
 * on the next generate.
 */
function convertFromBobFormat(mcpServers: unknown): McpServers {
  if (!isMcpServers(mcpServers)) {
    return {};
  }
  const result: McpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    const converted: Record<string, unknown> = {};
    let httpURL: string | undefined;
    for (const [key, value] of Object.entries(serverConfig)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "httpURL") {
        if (typeof value === "string") httpURL = value;
        continue;
      }
      converted[key] = value;
    }
    if (httpURL !== undefined) {
      converted.url = httpURL;
      converted.type = "http";
    } else if (typeof converted.url === "string" && converted.type === undefined) {
      converted.type = "sse";
    }
    result[serverName] = converted;
  }

  return result;
}

/**
 * IBM Bob MCP configuration.
 *
 * Bob IDE reads `mcpServers` from `<project>/.bob/mcp.json` (project scope)
 * and `~/.bob/mcp.json` (user scope); the project entry wins when both define
 * the same server name. Both files are dedicated to MCP. The project one is
 * deletable; the user one is created and edited by Bob IDE's own MCP settings
 * UI, so `--delete` leaves it in place rather than removing a file the user
 * did not create through rulesync. (Bob Shell reads its user-scoped servers
 * from `~/.bob/mcp_settings.json` instead, which rulesync does not write.)
 *
 * @see https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob
 * @see https://bob.ibm.com/docs/shell/configuration/mcp/mcp-bobshell
 */
export class BobMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent === undefined
        ? {}
        : parseBobMcpConfig({
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
    return {
      relativeDirPath: BOB_DIR,
      relativeFilePath: BOB_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<BobMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = parseBobMcpConfig({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new BobMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
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
  }: ToolMcpFromRulesyncMcpParams): Promise<BobMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    // Keep any top-level sibling keys of an existing file; only `mcpServers`
    // is regenerated.
    const fileContent =
      (await readFileContentOrNull(filePath)) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = parseBobMcpConfig({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });

    // Use getMcpServers() (not getJson()) so rulesync-only fields are
    // stripped before writing the Bob config.
    const mcpServers = convertToBobFormat(rulesyncMcp.getMcpServers(), logger);
    const bobConfig = { ...json, mcpServers };

    return new BobMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(bobConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromBobFormat(this.json.mcpServers);
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
  }: ToolMcpForDeletionParams): BobMcp {
    return new BobMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
