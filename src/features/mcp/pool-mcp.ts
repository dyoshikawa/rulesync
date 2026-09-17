import { join } from "node:path";

import {
  POOL_DIR,
  POOL_GLOBAL_DIR,
  POOL_MCP_SERVERS_KEY,
  POOL_SETTINGS_FILE_NAME,
} from "../../constants/pool-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
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
 * Single spelling of the settings.yaml codec/policy, matching the
 * `SHARED_CONFIG_OWNERSHIP` declaration for both scopes: fail closed on an
 * unparseable root rather than replacing the user's primary Pool settings with
 * generated output.
 */
function parsePoolSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "yaml",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * The remote transports Pool's `transport.type` accepts. `streamable-http` is
 * the canonical rulesync name for what Pool calls `http`; everything else is
 * left to the caller to reject.
 *
 * @see https://docs.poolside.ai/mcp-servers
 */
function asPoolRemoteType(stated: string | undefined, url: string): "http" | "sse" | undefined {
  if (stated === "sse") return "sse";
  if (stated === "http" || stated === "streamable-http") return "http";
  if (stated === undefined) {
    // With no transport stated, a `ws://`/`wss://` URL is not something Pool
    // can reach; every other URL is HTTP, its default remote transport.
    return /^wss?:\/\//i.test(url) ? undefined : "http";
  }
  return undefined;
}

/**
 * Pool spells remote headers as a list of `"Name: value"` strings rather than
 * a map, so the canonical record is flattened at generate time and split back
 * at the first `:` on import. A list entry without a `:` names no header and
 * is dropped with a warning — silently losing what may be a mistyped auth
 * header would leave the canonical file short of one without a trace.
 */
function headersRecordToPoolList(headers: Record<string, string>): string[] {
  return Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
}

function poolHeadersListToRecord(
  serverName: string,
  headers: unknown,
): Record<string, string> | undefined {
  if (!isStringArray(headers)) return undefined;
  const result: Record<string, string> = {};
  for (const entry of headers) {
    const separator = entry.indexOf(":");
    const name = separator > 0 ? entry.slice(0, separator).trim() : "";
    if (name === "" || PROTOTYPE_POLLUTION_KEYS.has(name)) {
      warnWithFallback(
        undefined,
        `Ignored malformed header ${quoteValueForWarning(entry)} in Pool MCP server ${quoteValueForWarning(serverName)}: expected "Name: value"`,
      );
      continue;
    }
    result[name] = entry.slice(separator + 1).trim();
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Pool's `allow`/`deny`/`enabled_tools` entries are glob patterns, while the
 * canonical `enabledTools`/`disabledTools` lists are literal tool names that
 * the other targets match verbatim. A pattern therefore imports as a name
 * that matches nothing elsewhere — a `deny` that quietly stops denying is the
 * case worth calling out — so it is copied as-is but warned about.
 */
const GLOB_METACHARACTERS = /[*?[]/;

function importPoolToolList(
  serverName: string,
  poolKey: string,
  value: unknown,
): string[] | undefined {
  if (!isStringArray(value)) {
    warnWithFallback(
      undefined,
      `Ignored malformed value for ${poolKey} in Pool MCP server ${quoteValueForWarning(serverName)}: expected a list of strings`,
    );
    return undefined;
  }
  const patterns = value.filter((entry) => GLOB_METACHARACTERS.test(entry));
  if (patterns.length > 0) {
    warnWithFallback(
      undefined,
      `${poolKey} in Pool MCP server ${quoteValueForWarning(serverName)} contains glob patterns (${patterns.map(quoteValueForWarning).join(", ")}); other tools match the imported tool names literally`,
    );
  }
  return value;
}

type McpServerConfig = McpServers[string];

/**
 * Pool's `transport` block for a remote server, or `null` (after a warning)
 * when the server has no url or names a transport Pool cannot reach.
 */
function toPoolTransport(
  name: string,
  config: McpServerConfig,
  logger?: Logger,
): Record<string, unknown> | null {
  const url = resolveRemoteMcpUrl(config);
  if (!url) {
    return warnAndSkipMcpServer({
      toolName: "Pool",
      serverName: name,
      reason: "a remote transport without a url",
      logger,
    });
  }
  const stated = config.type ?? config.transport;
  const type = asPoolRemoteType(stated, url);
  if (type === undefined) {
    // Rewriting a WebSocket server as `http` would hand Pool a server it
    // cannot connect to, so it is skipped out loud instead.
    return warnAndSkipMcpServer({
      toolName: "Pool",
      serverName: name,
      reason:
        stated === undefined
          ? "a WebSocket url, which Pool's remote transports (http and sse) cannot reach"
          : `the "${stated}" transport, which Pool does not offer for remote servers (only http and sse)`,
      logger,
    });
  }
  const transport: Record<string, unknown> = { type, url };
  if (config.headers && Object.keys(config.headers).length > 0) {
    transport.headers = headersRecordToPoolList(config.headers);
  }
  return transport;
}

/**
 * The transport-specific part of a Pool server entry: a `transport` block for
 * remote servers, `command`/`args`/`cwd` for stdio ones. `null` (after a
 * warning) when the server cannot be written.
 */
function toPoolTransportFields(
  name: string,
  config: McpServerConfig,
  logger?: Logger,
): Record<string, unknown> | null {
  if (isRemoteMcpServer(config)) {
    const transport = toPoolTransport(name, config, logger);
    return transport === null ? null : { transport };
  }
  const [command, ...args] = resolveLocalMcpCommand(config);
  if (!command) {
    return warnAndSkipMcpServer({
      toolName: "Pool",
      serverName: name,
      reason: "a stdio transport without a command",
      logger,
    });
  }
  const fields: Record<string, unknown> = { command, args };
  if (config.cwd) {
    fields.cwd = config.cwd;
  }
  return fields;
}

/**
 * The fields shared by stdio and remote entries. Tool filters map onto Pool's
 * own switches — `enabledTools` becomes `enabled_tools` (the tools Pool
 * exposes at all) and `disabledTools` becomes `deny` (patterns agents may
 * never use); the Pool-only approval allowlist is authored as `poolAllow` and
 * written as `allow`. `disabled: true` is spelled the same on both sides.
 */
function toPoolCommonFields(config: McpServerConfig): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (config.env && Object.keys(config.env).length > 0) {
    fields.env = config.env;
  }
  if (config.enabledTools && config.enabledTools.length > 0) {
    fields.enabled_tools = config.enabledTools;
  }
  if (config.poolAllow && config.poolAllow.length > 0) {
    fields.allow = config.poolAllow;
  }
  if (config.disabledTools && config.disabledTools.length > 0) {
    fields.deny = config.disabledTools;
  }
  if (config.disabled === true) {
    fields.disabled = true;
  }
  return fields;
}

/**
 * Convert canonical rulesync servers to Pool's native `mcp_servers` shape:
 * stdio servers carry `command`/`args`/`cwd`/`env`, remote servers carry a
 * `transport` block (`type` of `http` or `sse`, `url`, optional `headers`
 * list) plus optional `env`; see `toPoolCommonFields` for the tool filters.
 *
 * @see https://docs.poolside.ai/mcp-servers
 */
function convertToPoolFormat(mcpServers: McpServers, logger?: Logger): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (!isRecord(config)) continue;

    if (declaresNoTransport(config)) {
      warnAndSkipMcpServer({
        toolName: "Pool",
        serverName: name,
        reason: "no transport",
        logger,
      });
      continue;
    }

    const transportFields = toPoolTransportFields(name, config, logger);
    if (transportFields === null) continue;

    result[name] = { ...transportFields, ...toPoolCommonFields(config) };
  }

  return result;
}

const POOL_TO_CANONICAL_TOOL_LIST_KEYS: Record<
  string,
  "enabledTools" | "disabledTools" | "poolAllow"
> = {
  enabled_tools: "enabledTools",
  deny: "disabledTools",
  allow: "poolAllow",
};

/**
 * Convert Pool's native `mcp_servers` shape back to canonical rulesync
 * servers: the `transport` block is flattened to `type`/`url`/`headers`,
 * `enabled_tools` maps back to `enabledTools`, `deny` to `disabledTools` and
 * `allow` to the namespaced `poolAllow` (see `McpServerSchema`). Unknown keys
 * pass through untouched so an import keeps whatever a hand-authored entry
 * declared; generation back out is a whitelist, so only the keys
 * `convertToPoolFormat` writes are re-emitted.
 */
function convertFromPoolFormat(poolServers: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(poolServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "transport") {
        if (!isRecord(value)) continue;
        if (typeof value.type === "string") {
          converted.type = value.type;
        }
        if (typeof value.url === "string") {
          converted.url = value.url;
        }
        const headers = poolHeadersListToRecord(name, value.headers);
        if (headers) {
          converted.headers = headers;
        }
        continue;
      }
      const canonicalKey = POOL_TO_CANONICAL_TOOL_LIST_KEYS[key];
      if (canonicalKey) {
        const list = importPoolToolList(name, key, value);
        if (list) {
          converted[canonicalKey] = list;
        }
        continue;
      }
      converted[key] = value;
    }

    result[name] = converted;
  }

  return result;
}

/**
 * Pool MCP servers.
 *
 * Pool reads MCP servers from the `mcp_servers` block of its settings file:
 * `<project>/.poolside/settings.yaml` at project scope (shared and committed)
 * and `~/.config/poolside/settings.yaml` at user scope. The untracked
 * `.poolside/settings.local.yaml` overlay, which Pool layers on top of both,
 * is left to the user. Every other top-level settings key is preserved and
 * the file is never deleted.
 *
 * @see https://docs.poolside.ai/mcp-servers
 * @see https://docs.poolside.ai/settings-file-reference
 */
export class PoolMcp extends ToolMcp {
  private readonly settings: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.settings = parsePoolSettings(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getSettings(): Record<string, unknown> {
    return this.settings;
  }

  override isDeletable(): boolean {
    // settings.yaml is Pool's primary settings file, so it must never be
    // removed wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: global ? POOL_GLOBAL_DIR : POOL_DIR,
      relativeFilePath: POOL_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<PoolMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new PoolMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<PoolMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    // `poolAllow` is stripped by `getMcpServers()` so it cannot leak into other
    // tools' configs, so read it back off the unfiltered source JSON — the
    // same re-merge musecode does for `musecodeMode`.
    const mcpServers = Object.fromEntries(
      Object.entries(rulesyncMcp.getMcpServers()).map(([serverName, serverConfig]) => {
        const rawServer = rulesyncMcp.getRawMcpServer(serverName);
        const poolAllow = isRecord(rawServer) ? rawServer.poolAllow : undefined;
        return [serverName, { ...serverConfig, ...(isStringArray(poolAllow) && { poolAllow }) }];
      }),
    );
    const converted = convertToPoolFormat(mcpServers, logger);

    return new PoolMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: { [POOL_MCP_SERVERS_KEY]: converted },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = isRecord(this.settings[POOL_MCP_SERVERS_KEY])
      ? this.settings[POOL_MCP_SERVERS_KEY]
      : {};
    const converted = convertFromPoolFormat(servers);

    // Do not spread the full settings document: Pool's own keys (`pool`,
    // `tools`, `sandbox`, ...) must not leak into rulesync mcp.json.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: converted }, null, 2),
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
  }: ToolMcpForDeletionParams): PoolMcp {
    // The shared settings file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new PoolMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
