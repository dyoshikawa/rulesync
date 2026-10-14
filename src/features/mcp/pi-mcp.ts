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
  splitMcpServersByTransport,
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
 * The only keys a project override entry for a user-level server carries:
 * Pi reads a `.pi/mcp.json` entry without `command`, `url` or `type` as an
 * override of `enabled`, `exposure` and `toolExposure` of the user-level server
 * with the same name, and keeps the rest of that server.
 *
 * @see https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/mcp.md
 */
const PI_OVERRIDE_PASSTHROUGH_KEYS = ["exposure", "toolExposure"] as const;

/**
 * Pi rejects a server whose name has any other character, and treats names
 * that differ only in `-` and `_` as one server (its tools share the
 * `mcp__<name>` namespace with `-` replaced by `_`), rejecting the second.
 */
const PI_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const toPiNamespace = (serverName: string): string => serverName.replace(/-/g, "_");

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
 * start or reach — a remote transport without a URL, an SSE or WebSocket
 * server, or a stdio entry without a command — is rejected by Pi, so it is
 * skipped with a warning (`null`). A server with no transport at all is a
 * project override instead (see `convertOverrideToPi`).
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
    if (!/^https?:\/\//i.test(url)) {
      return warnAndSkipMcpServer({
        toolName: "Pi",
        serverName,
        reason: "a url that is not http or https, which Pi does not support",
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
 * A transport-less server in the project file becomes a Pi override entry for
 * the user-level server of the same name. `disabled` maps to `enabled` both
 * ways (an explicit `disabled: false` is "Enable in this project"), and any key
 * Pi ignores on an override is dropped with a warning. The global file has no
 * layer below it to override, so the entry is skipped there.
 */
function convertOverrideToPi({
  serverName,
  serverConfig,
  global,
  logger,
}: {
  serverName: string;
  serverConfig: McpServers[string];
  global: boolean;
  logger?: Logger;
}): Record<string, unknown> | null {
  if (global) {
    return warnAndSkipMcpServer({ toolName: "Pi", serverName, reason: "no transport", logger });
  }
  const record: Record<string, unknown> = serverConfig;
  const override: Record<string, unknown> = {};
  if (typeof serverConfig.disabled === "boolean") {
    override.enabled = !serverConfig.disabled;
  }
  for (const key of PI_OVERRIDE_PASSTHROUGH_KEYS) {
    if (record[key] !== undefined) override[key] = record[key];
  }
  if (Object.keys(override).length === 0) {
    return warnAndSkipMcpServer({
      toolName: "Pi",
      serverName,
      reason:
        "no transport and nothing a Pi project override sets (disabled, exposure, toolExposure)",
      logger,
    });
  }
  const droppedKeys = Object.keys(record).filter(
    (key) =>
      key !== "disabled" &&
      !(PI_OVERRIDE_PASSTHROUGH_KEYS as readonly string[]).includes(key) &&
      !PROTOTYPE_POLLUTION_KEYS.has(key),
  );
  if (droppedKeys.length > 0) {
    logger?.warn(
      `Pi MCP: dropping ${droppedKeys.map((key) => quoteValueForWarning(key)).join(", ")} of the project override ${quoteValueForWarning(serverName)}: Pi reads only enabled, exposure and toolExposure from an entry without a transport.`,
    );
  }
  return override;
}

/**
 * Whether Pi rejects the server name, either outright or because an earlier
 * server already took its `mcp__<name>` namespace; warns when it does.
 */
function isRejectedServerName({
  serverName,
  namespaces,
  logger,
}: {
  serverName: string;
  namespaces: Map<string, string>;
  logger?: Logger;
}): boolean {
  if (!PI_SERVER_NAME_PATTERN.test(serverName)) {
    warnAndSkipMcpServer({
      toolName: "Pi",
      serverName,
      reason: 'a name Pi rejects (use letters, digits, "_" and "-")',
      logger,
    });
    return true;
  }
  const clash = namespaces.get(toPiNamespace(serverName));
  if (clash !== undefined) {
    warnAndSkipMcpServer({
      toolName: "Pi",
      serverName,
      reason: `a name Pi treats as the same server as ${quoteValueForWarning(clash)} ("-" and "_" are equivalent)`,
      logger,
    });
    return true;
  }
  return false;
}

/**
 * Convert one canonical server to its Pi entry, or `null` when it is skipped.
 * Besides the transport fields, Pi switches a server off with `enabled: false`
 * and reads `timeout` in seconds (canonical: milliseconds). `auth` is dropped
 * with a warning from the project file, since Pi accepts it only in the global
 * one (it drops the whole server otherwise). A server without a transport is a
 * project override entry instead.
 */
function convertServerToPi({
  serverName,
  serverConfig,
  global,
  logger,
}: {
  serverName: string;
  serverConfig: McpServers[string];
  global: boolean;
  logger?: Logger;
}): Record<string, unknown> | null {
  if (declaresNoTransport(serverConfig)) {
    return convertOverrideToPi({ serverName, serverConfig, global, logger });
  }

  const converted = convertTransportToPi({ serverName, serverConfig, logger });
  if (!converted) return null;

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
  if (!global && "auth" in converted) {
    delete converted.auth;
    logger?.warn(
      `Pi MCP: dropping the "auth" of ${quoteValueForWarning(serverName)}: Pi accepts it only in the global ~/.pi/agent/mcp.json.`,
    );
  }
  if (hasUnexpandedEnvVarRef(converted)) {
    logger?.warn(
      `Pi MCP: ${quoteValueForWarning(serverName)} carries an environment variable reference Pi does not expand. Pi expands only \${VAR} and $VAR in env and headers values, and only a leading ~/ in command, args and cwd.`,
    );
  }
  return converted;
}

/**
 * Convert the canonical server map to Pi's `mcpServers` shape. A server name
 * Pi rejects is skipped with a warning.
 */
function convertToPiFormat({
  mcpServers,
  global,
  logger,
}: {
  mcpServers: McpServers;
  global: boolean;
  logger?: Logger;
}): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  const namespaces = new Map<string, string>();

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;
    if (isRejectedServerName({ serverName, namespaces, logger })) continue;

    const converted = convertServerToPi({ serverName, serverConfig, global, logger });
    if (!converted) continue;

    namespaces.set(toPiNamespace(serverName), serverName);
    result[serverName] = converted;
  }

  return result;
}

/**
 * Convert Pi's `mcpServers` back to the canonical shape: `enabled: false`
 * becomes `disabled: true` and `timeout` (seconds) becomes milliseconds; every
 * other key is already canonical. On a transport-less override entry an
 * explicit `enabled: true` is kept as `disabled: false`, since it switches on a
 * user-level server the user turned off.
 */
function convertFromPiFormat(mcpServers: McpServers): McpServers {
  const result: McpServers = {};
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;
    const { enabled, timeout, ...rest } = serverConfig as Record<string, unknown>;
    const keepsEnabled = enabled === true && declaresNoTransport(rest as McpServers[string]);
    const converted: Record<string, unknown> =
      enabled === false || keepsEnabled ? { ...rest, disabled: !enabled } : rest;
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
      mcpServers: convertToPiFormat({ mcpServers: rulesyncMcp.getMcpServers(), global, logger }),
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
    // A transport-less entry is a Pi project override of a user-level server,
    // so it goes in the block only Pi reads rather than into the shared map
    // every other tool writes out.
    const { shared, toolOnly } = splitMcpServersByTransport(convertFromPiFormat(mcpServers));
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          mcpServers: shared,
          ...(Object.keys(toolOnly).length > 0 && { pi: { mcpServers: toolOnly } }),
        },
        null,
        2,
      ),
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
