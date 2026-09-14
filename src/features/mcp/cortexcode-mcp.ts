import { join } from "node:path";

import {
  CORTEXCODE_GLOBAL_DIR_PATH,
  CORTEXCODE_MCP_FILE_NAME,
} from "../../constants/cortexcode-paths.js";
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

const CORTEXCODE_GLOBAL_ONLY_MESSAGE =
  "Snowflake Cortex Code MCP is global-only; use --global to sync ~/.snowflake/cortex/mcp.json";

type CortexcodeMcpServers = Record<string, Record<string, unknown>>;

/**
 * Parse a Cortex Code MCP file, failing closed on malformed JSON or a
 * non-object root (`null`, an array, a scalar) rather than spreading whatever
 * came back into the regenerated file.
 */
function parseCortexcodeMcpConfig({
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
    throw new Error(
      `Failed to parse Cortex Code MCP config at ${relativePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse Cortex Code MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

/**
 * The remote transport Cortex Code reads a server as. Cortex Code documents
 * exactly three transports — `stdio`, `http` and `sse` — each spelled out in
 * an explicit `type` key. `http` is also the canonical rulesync spelling, and
 * a bare `url` defaults to it, streamable HTTP being the current MCP
 * transport. `streamable-http` is folded into `http`. A `ws(s)://` URL or any
 * other stated transport is something Cortex Code cannot reach, so
 * `undefined` tells the caller to skip the server.
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility#transport-types
 */
function asCortexcodeRemoteType(
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
 * Convert the canonical server map to the shape Cortex Code documents for
 * `~/.snowflake/cortex/mcp.json`: every server carries an explicit `type`
 * (`stdio`, `http` or `sse`); a stdio server carries `command` (plus `args`)
 * and a remote server carries `url`. The canonical `transport` alias and the
 * Claude-style `httpUrl` alias are folded into `type`/`url`; `env`, `headers`,
 * `oauth` and `timeout` pass through, as Cortex Code documents all of them.
 *
 * A server Cortex Code cannot start or reach — no transport at all, a remote
 * transport without a URL, a WebSocket URL, or a stdio entry without a
 * command — is skipped with a warning rather than written in a broken form.
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility#mcp-configuration
 */
function convertToCortexcodeFormat(mcpServers: McpServers, logger?: Logger): CortexcodeMcpServers {
  const result: CortexcodeMcpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    if (declaresNoTransport(serverConfig)) {
      warnAndSkipMcpServer({ toolName: "Cortex Code", serverName, reason: "no transport", logger });
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
          toolName: "Cortex Code",
          serverName,
          reason: "a remote transport without a url",
          logger,
        });
        continue;
      }
      const stated = type ?? transport;
      const remoteType = asCortexcodeRemoteType(stated, url);
      if (remoteType === undefined) {
        warnAndSkipMcpServer({
          toolName: "Cortex Code",
          serverName,
          reason:
            stated === undefined
              ? "a WebSocket url, which Cortex Code's remote transports (http and sse) cannot reach"
              : `the "${stated}" transport, which Cortex Code does not offer for remote servers (only http and sse)`,
          logger,
        });
        continue;
      }
      converted.type = remoteType;
      converted.url = url;
    } else {
      const [command, ...args] = splitLocalMcpCommand(serverConfig);
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "Cortex Code",
          serverName,
          reason: "a stdio transport without a command",
          logger,
        });
        continue;
      }
      converted.type = "stdio";
      converted.command = command;
      if (args.length > 0) {
        converted.args = args;
      }
    }

    for (const [key, value] of Object.entries(rest)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      // `env` and `headers` are key/value maps Cortex Code spreads into the
      // server's process environment and HTTP requests, so their keys are
      // sanitized too.
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
 * Convert Cortex Code's server map back to the canonical shape. The
 * documented spelling (`type` + `command`/`url`) is already canonical, so
 * entries pass through with only prototype-pollution keys dropped.
 */
function convertFromCortexcodeFormat(mcpServers: unknown): McpServers {
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
 * Snowflake Cortex Code MCP configuration.
 *
 * Cortex Code reads `mcpServers` only from the single user-scoped file
 * `~/.snowflake/cortex/mcp.json`; no project-scoped MCP location is
 * documented, so the target is global-only. The file is created and edited by
 * `cortex mcp add` as well, so `--delete` leaves it in place rather than
 * removing a file the user did not create through rulesync.
 *
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility#mcp-configuration
 */
export class CortexcodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent === undefined
        ? {}
        : parseCortexcodeMcpConfig({
            fileContent: this.fileContent,
            relativePath: join(this.relativeDirPath, this.relativeFilePath),
          });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: CORTEXCODE_GLOBAL_DIR_PATH,
      relativeFilePath: CORTEXCODE_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CortexcodeMcp> {
    if (!global) {
      throw new Error(CORTEXCODE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = parseCortexcodeMcpConfig({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new CortexcodeMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CortexcodeMcp> {
    if (!global) {
      throw new Error(CORTEXCODE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    // Keep any top-level sibling keys of an existing file; only `mcpServers`
    // is regenerated.
    const fileContent =
      (await readFileContentOrNull(filePath)) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = parseCortexcodeMcpConfig({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });

    // Use getMcpServers() (not getJson()) so rulesync-only fields are
    // stripped before writing the Cortex Code config.
    const mcpServers = convertToCortexcodeFormat(rulesyncMcp.getMcpServers(), logger);
    const cortexcodeConfig = { ...json, mcpServers };

    return new CortexcodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(cortexcodeConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromCortexcodeFormat(this.json.mcpServers);
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
  }: ToolMcpForDeletionParams): CortexcodeMcp {
    return new CortexcodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
