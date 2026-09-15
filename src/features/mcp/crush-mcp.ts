import { join } from "node:path";

import { CRUSH_MCP_KEY } from "../../constants/crush-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { type Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  crushConfigImportContent,
  getCrushConfigSettablePaths,
  parseCrushConfig,
  resolveCrushConfigFile,
  warnCrushTwinLeftovers,
} from "../crush-config.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
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
 * Crush-only MCP fields that have no canonical counterpart and pass through
 * verbatim in both directions. `oauth*` drive Crush's OAuth 2.1 flow for HTTP
 * servers; `sessionless` marks a server that issues no `Mcp-Session-Id`.
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
 */
const CRUSH_PASSTHROUGH_KEYS = [
  "sessionless",
  "oauth",
  "oauth_client_id",
  "oauth_client_secret",
  "oauth_callback_port",
] as const;

/**
 * The remote transports Crush's `MCPType` enum accepts, spelled the way it
 * reads them. `streamable-http` is the canonical rulesync name for what Crush
 * calls `http`; a WebSocket server has no Crush transport and is left to the
 * caller to reject.
 */
function asCrushRemoteType(stated: string | undefined, url: string): "http" | "sse" | undefined {
  if (stated === "sse") return "sse";
  if (stated === "http" || stated === "streamable-http") return "http";
  if (stated === undefined) {
    return /^wss?:\/\//i.test(url) ? undefined : "http";
  }
  return undefined;
}

function copyPassthroughKeys({
  from,
  to,
}: {
  from: Record<string, unknown>;
  to: Record<string, unknown>;
}): void {
  for (const key of CRUSH_PASSTHROUGH_KEYS) {
    if (Object.hasOwn(from, key) && from[key] !== undefined) {
      to[key] = from[key];
    }
  }
}

/**
 * The transport half of a remote server (`type`, `url`, `headers`), or null
 * when Crush could not reach it and the server was skipped with a warning.
 */
function convertRemoteTransport({
  name,
  config,
  logger,
}: {
  name: string;
  config: McpServers[string];
  logger?: Logger;
}): Record<string, unknown> | null {
  const url = resolveRemoteMcpUrl(config);
  if (!url) {
    warnAndSkipMcpServer({
      toolName: "Crush",
      serverName: name,
      reason: "a remote transport without a url",
      logger,
    });
    return null;
  }
  const stated = config.type ?? config.transport;
  const type = asCrushRemoteType(stated, url);
  if (type === undefined) {
    // Rewriting a WebSocket server as `http` would hand Crush a server it
    // cannot connect to, so it is skipped out loud instead.
    warnAndSkipMcpServer({
      toolName: "Crush",
      serverName: name,
      reason:
        stated === undefined
          ? "a WebSocket url, which Crush's remote transports (http and sse) cannot reach"
          : `the "${stated}" transport, which Crush does not offer for remote servers (only http and sse)`,
      logger,
    });
    return null;
  }
  const converted: Record<string, unknown> = { type, url };
  if (config.headers && Object.keys(config.headers).length > 0) {
    converted.headers = config.headers;
  }
  return converted;
}

/**
 * The transport half of a stdio server (`type`, `command`, `args`, `env`), or
 * null when it has no command and was skipped with a warning.
 */
function convertStdioTransport({
  name,
  config,
  logger,
}: {
  name: string;
  config: McpServers[string];
  logger?: Logger;
}): Record<string, unknown> | null {
  const [command, ...args] = resolveLocalMcpCommand(config);
  if (!command) {
    warnAndSkipMcpServer({
      toolName: "Crush",
      serverName: name,
      reason: "a stdio transport without a command",
      logger,
    });
    return null;
  }
  const converted: Record<string, unknown> = { type: "stdio", command };
  if (args.length > 0) {
    converted.args = args;
  }
  if (config.env && Object.keys(config.env).length > 0) {
    converted.env = config.env;
  }
  return converted;
}

/**
 * Convert canonical rulesync servers to the `mcp.<name>` shape of crush.json.
 * `type` is required by Crush's schema, so it is always written: stdio servers
 * carry `type: "stdio"` with `command`/`args`/`env`, remote servers `http` or
 * `sse` with `url` and optional `headers`. `disabled`, the per-server
 * `disabledTools`/`enabledTools` filters (`disabled_tools`/`enabled_tools`)
 * and `timeout` (which Crush reads in seconds) map onto their Crush fields.
 *
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
 */
function convertToCrushFormat(mcpServers: McpServers, logger?: Logger): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (!isRecord(config)) continue;

    if (declaresNoTransport(config)) {
      warnAndSkipMcpServer({
        toolName: "Crush",
        serverName: name,
        reason: "no transport",
        logger,
      });
      continue;
    }

    const converted = isRemoteMcpServer(config)
      ? convertRemoteTransport({ name, config, logger })
      : convertStdioTransport({ name, config, logger });
    if (converted === null) {
      continue;
    }
    if (config.disabled === true) {
      converted.disabled = true;
    }
    if (config.disabledTools && config.disabledTools.length > 0) {
      converted.disabled_tools = config.disabledTools;
    }
    if (config.enabledTools && config.enabledTools.length > 0) {
      converted.enabled_tools = config.enabledTools;
    }
    if (typeof config.timeout === "number") {
      converted.timeout = config.timeout;
    }
    copyPassthroughKeys({ from: config, to: converted });

    result[name] = converted;
  }

  return result;
}

/**
 * Convert the `mcp.<name>` entries of crush.json back to canonical rulesync
 * servers. `stdio` is Crush's default `type`, so it is dropped (a canonical
 * server with a `command` is stdio already); `http` and `sse` are kept as the
 * canonical transport names; `disabled_tools`/`enabled_tools` become the
 * canonical `disabledTools`/`enabledTools`. The Crush-only OAuth and
 * `sessionless` fields pass through, and any other key is kept verbatim so an
 * import preserves what a hand-authored entry declared.
 */
function convertFromCrushFormat(crushServers: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(crushServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      switch (key) {
        case "type":
          if (value === "http" || value === "sse") {
            converted.type = value;
          }
          break;
        case "disabled_tools":
          if (isStringArray(value)) {
            converted.disabledTools = value;
          }
          break;
        case "enabled_tools":
          if (isStringArray(value)) {
            converted.enabledTools = value;
          }
          break;
        case "oauth_token":
          // Crush persists the negotiated token here at runtime
          // (`jsonschema:"-"`); it is per-machine state, not configuration.
          break;
        default:
          converted[key] = value;
      }
    }

    result[name] = converted;
  }

  return result;
}

/**
 * Crush MCP servers.
 *
 * Crush reads MCP servers from the `mcp` key of its JSON config:
 * `<project>/crush.json` (or an existing `.crush.json`; Crush merges the pair,
 * objects recursively) at project scope and `~/.config/crush/crush.json` at
 * user scope. The
 * `crushrc` Bash config that Crush now recommends compiles its `mcp add`
 * builtin into the same `mcp.<name>` entries and overrides the JSON key by
 * key, so a `crushrc` next to the generated file takes precedence. Every
 * other top-level key of the file is preserved; the file is never deleted.
 *
 * @see https://github.com/charmbracelet/crush/blob/main/docs/config/README.md
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
 */
export class CrushMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseCrushConfig(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // crush.json is Crush's primary config file, so it must never be removed
    // wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return getCrushConfigSettablePaths({ global });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CrushMcp> {
    const location = await resolveCrushConfigFile({ outputRoot, global });

    return new CrushMcp({
      outputRoot,
      relativeDirPath: location.relativeDirPath,
      relativeFilePath: location.relativeFilePath,
      fileContent: crushConfigImportContent(location),
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CrushMcp> {
    const location = await resolveCrushConfigFile({ outputRoot, global });
    const existingContent = location.fileContent ?? "";
    warnCrushTwinLeftovers({ location, ownedPaths: [[CRUSH_MCP_KEY]], logger });

    const converted = convertToCrushFormat(rulesyncMcp.getMcpServers(), logger);

    return new CrushMcp({
      outputRoot,
      relativeDirPath: location.relativeDirPath,
      relativeFilePath: location.relativeFilePath,
      // Keyed by the base settable paths: a resolved `.crush.json` twin shares
      // the `crush.json` ownership declaration.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(this.getSettablePaths({ global })),
        feature: "mcp",
        existingContent,
        patch: { [CRUSH_MCP_KEY]: converted },
        filePath: location.filePath,
        logger,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = isRecord(this.json[CRUSH_MCP_KEY]) ? this.json[CRUSH_MCP_KEY] : {};
    const converted = convertFromCrushFormat(servers);

    // Do not spread the full config JSON: Crush's own keys (providers, models,
    // options, ...) must not leak into rulesync mcp.json.
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
  }: ToolMcpForDeletionParams): CrushMcp {
    // The shared config file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new CrushMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ [CRUSH_MCP_KEY]: {} }, null, 2),
      validate: false,
      global,
    });
  }
}
