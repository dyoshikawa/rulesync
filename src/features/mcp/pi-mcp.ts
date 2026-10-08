import { join } from "node:path";

import { PI_AGENT_DIR_PATH, PI_DIR, PI_MCP_FILE_NAME } from "../../constants/pi-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
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

/**
 * Canonical keys consumed by the conversion below (or with no Pi counterpart),
 * which therefore are not copied verbatim.
 */
const CONSUMED_CANONICAL_KEYS = new Set([
  "type",
  "transport",
  "url",
  "httpUrl",
  "command",
  "args",
  "timeout",
  "disabled",
  "enabledTools",
  "disabledTools",
]);

const MILLISECONDS_PER_SECOND = 1000;

/**
 * An environment variable reference Pi leaves as written: any `$` reference in
 * `command`, `args` or `cwd` (Pi expands only a leading `~/` there), and the
 * `${VAR:-default}` form in `env` / `headers` (Pi expands `${VAR}` and `$VAR`
 * there, but not a default).
 */
const ENV_VAR_REF_PATTERN = /\$\{?[A-Za-z_]/;
const ENV_VAR_DEFAULT_REF_PATTERN = /\$\{[A-Za-z_][A-Za-z0-9_]*:-/;

function parsePiMcpConfig({
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
    throw new Error(`Failed to parse Pi MCP config at ${relativePath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse Pi MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

function hasUnexpandedEnvVarRef(serverConfig: Record<string, unknown>): boolean {
  const spawnValues = [serverConfig.command, serverConfig.args, serverConfig.cwd].flat();
  if (spawnValues.some((value) => typeof value === "string" && ENV_VAR_REF_PATTERN.test(value))) {
    return true;
  }
  return [serverConfig.env, serverConfig.headers].some(
    (record) =>
      isRecord(record) &&
      Object.values(record).some(
        (value) => typeof value === "string" && ENV_VAR_DEFAULT_REF_PATTERN.test(value),
      ),
  );
}

/**
 * The transport fields Pi reads for one server: `type` `stdio` with a string
 * `command` plus `args`, or `type` `http` with a `url`. A server Pi cannot
 * start or reach — no transport, a remote transport without a URL, an SSE or
 * WebSocket server, or a stdio entry without a command — is rejected by Pi, so
 * it is skipped with a warning (`null`).
 */
function convertTransportToPi({
  serverName,
  serverConfig,
  logger,
}: {
  serverName: string;
  serverConfig: McpServers[string];
  logger?: Logger;
}): Record<string, unknown> | null {
  if (declaresNoTransport(serverConfig)) {
    return warnAndSkipMcpServer({ toolName: "Pi", serverName, reason: "no transport", logger });
  }

  if (isRemoteMcpServer(serverConfig)) {
    const url = resolveRemoteMcpUrl(serverConfig);
    const stated = serverConfig.type ?? serverConfig.transport;
    if (!url) {
      return warnAndSkipMcpServer({
        toolName: "Pi",
        serverName,
        reason: "a remote transport without a url",
        logger,
      });
    }
    if (stated === "sse" || stated === "ws") {
      return warnAndSkipMcpServer({
        toolName: "Pi",
        serverName,
        reason: `an ${stated === "sse" ? "SSE" : "WebSocket"} transport, which Pi does not support`,
        logger,
      });
    }
    return { type: "http", url };
  }

  const [command, ...args] = resolveLocalMcpCommand(serverConfig);
  if (!command) {
    return warnAndSkipMcpServer({
      toolName: "Pi",
      serverName,
      reason: "a stdio transport without a command",
      logger,
    });
  }
  return { type: "stdio", command, ...(args.length > 0 && { args }) };
}

/**
 * Convert the canonical server map to Pi's `mcpServers` shape. Besides the
 * transport fields, Pi switches a server off with `enabled: false` and reads
 * `timeout` in seconds (canonical: milliseconds).
 */
function convertToPiFormat(
  mcpServers: McpServers,
  logger?: Logger,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    const converted = convertTransportToPi({ serverName, serverConfig, logger });
    if (!converted) continue;

    for (const [key, value] of Object.entries(serverConfig)) {
      if (CONSUMED_CANONICAL_KEYS.has(key) || PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      converted[key] = value;
    }
    if (serverConfig.timeout !== undefined) {
      // Pi rejects the whole server for a timeout that is not a positive number.
      if (Number.isFinite(serverConfig.timeout) && serverConfig.timeout > 0) {
        converted.timeout = serverConfig.timeout / MILLISECONDS_PER_SECOND;
      } else {
        logger?.warn(
          `Pi MCP: dropping the "timeout" of ${quoteValueForWarning(serverName)}: expected a positive number of milliseconds.`,
        );
      }
    }
    if (serverConfig.disabled === true) {
      converted.enabled = false;
    }
    if (hasUnexpandedEnvVarRef(converted)) {
      logger?.warn(
        `Pi MCP: ${quoteValueForWarning(serverName)} carries an environment variable reference Pi does not expand. Pi expands only \${VAR} and $VAR in env and headers values, and only a leading ~/ in command, args and cwd.`,
      );
    }

    result[serverName] = converted;
  }

  return result;
}

/**
 * Convert Pi's `mcpServers` back to the canonical shape: `enabled: false`
 * becomes `disabled: true` and `timeout` (seconds) becomes milliseconds; every
 * other key is already canonical.
 */
function convertFromPiFormat(mcpServers: McpServers): McpServers {
  const result: McpServers = {};
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;
    const { enabled, timeout, ...rest } = serverConfig as Record<string, unknown>;
    const converted: Record<string, unknown> =
      enabled === false ? { ...rest, disabled: true } : rest;
    if (typeof timeout === "number") {
      converted.timeout = timeout * MILLISECONDS_PER_SECOND;
    } else if (timeout !== undefined) {
      converted.timeout = timeout;
    }
    result[serverName] = converted;
  }
  return result;
}

/**
 * MCP generator for Pi's built-in MCP support (Pi 1.0+). Servers go to the
 * `mcpServers` map of `.pi/mcp.json` (project, read once the project is
 * trusted) or `~/.pi/agent/mcp.json` (global). Other top-level keys of an
 * existing file (`autoEnableCodemode`, ...) are preserved. Pi expands `${VAR}`
 * in `env` and `headers` values itself, so those are written unchanged.
 *
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/mcp-servers.ts
 */
export class PiMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent !== undefined
        ? parsePiMcpConfig({
            fileContent: this.fileContent,
            relativePath: join(this.relativeDirPath, this.relativeFilePath),
          })
        : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // The global file is shared with servers added through `pi mcp add` / `/mcp`.
    return !this.global;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: global ? PI_AGENT_DIR_PATH : PI_DIR,
      relativeFilePath: PI_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<PiMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';

    return new PiMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<PiMcp> {
    const paths = this.getSettablePaths({ global });
    const relativePath = join(paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readFileContentOrNull(join(outputRoot, relativePath));
    const existing = existingContent
      ? parsePiMcpConfig({ fileContent: existingContent, relativePath })
      : {};

    const piConfig = {
      ...existing,
      mcpServers: convertToPiFormat(rulesyncMcp.getMcpServers(), logger),
    };

    return new PiMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(piConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertFromPiFormat(mcpServers) }, null, 2),
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
  }: ToolMcpForDeletionParams): PiMcp {
    return new PiMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
