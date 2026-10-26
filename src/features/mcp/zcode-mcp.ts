import { join } from "node:path";

import {
  ZCODE_CONFIG_FILE_NAME,
  ZCODE_DIR,
  ZCODE_GLOBAL_CONFIG_DIR_PATH,
  ZCODE_MCP_CONFIG_KEY,
  ZCODE_MCP_SERVERS_KEY,
} from "../../constants/zcode-paths.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  resolveHttpOrSseRemoteType,
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
 * Single spelling of the config.json codec/policy, matching the
 * `SHARED_CONFIG_OWNERSHIP` declaration for both scopes: fail closed on an
 * unparseable root rather than replacing the user's primary ZCode config with
 * generated output.
 */
function parseZcodeConfig(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * The keys each OAuth flow of ZCode's per-server `oauth` union accepts on a
 * remote server, and which of them are required. Read off the 3.14.3–3.16.2
 * runtime config schema, since ZCode's MCP page only says to "enable OAuth for
 * the service in its configuration". Both variants are strict, so any other
 * key would make ZCode skip the server.
 */
const ZCODE_OAUTH_FLOWS: Readonly<
  Record<string, { required: readonly string[]; optional: readonly string[] }>
> = {
  client_credentials: {
    required: ["clientId", "clientSecret"],
    optional: ["clientName", "scope"],
  },
  authorization_code: {
    required: [],
    optional: ["clientId", "clientSecret", "clientName", "redirectPath", "scope"],
  },
};

/**
 * The `protocolVersion` values ZCode's server schema accepts (an enum on a
 * strict object, so any other value makes ZCode skip the server).
 */
const ZCODE_PROTOCOL_VERSIONS: ReadonlySet<unknown> = new Set(["auto", "legacy", "2026-07-28"]);

/**
 * The namespaced canonical key that carries ZCode's `oauth`. The canonical
 * `oauth` already holds Claude Code's `{ clientId }` object, and ZCode's shape
 * may carry a client secret, so it is kept apart (the `crushOauth*`
 * precedent) and stripped by `RulesyncMcp.getMcpServers()`.
 */
const ZCODE_OAUTH_CANONICAL_KEY = "zcodeOauth";

/**
 * Whether an `oauth` value names one of ZCode's flows.
 */
function isZcodeOauth(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.type === "string" && value.type in ZCODE_OAUTH_FLOWS;
}

/**
 * Build ZCode's `oauth` from a `zcodeOauth` value: only the keys of the named
 * flow are kept, as strings. A value naming no ZCode flow, or missing a key
 * the flow requires, is dropped with a warning instead of making ZCode skip
 * the server.
 */
function toZcodeOauth({
  serverName,
  value,
  logger,
}: {
  serverName: string;
  value: unknown;
  logger?: Logger;
}): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isZcodeOauth(value)) {
    logger?.warn(
      `ZCode MCP server "${serverName}": dropping zcodeOauth, as its type must be "client_credentials" or "authorization_code".`,
    );
    return undefined;
  }
  const type = String(value.type);
  const flow = ZCODE_OAUTH_FLOWS[type];
  if (!flow) return undefined;
  const missing = flow.required.filter((key) => typeof value[key] !== "string");
  if (missing.length > 0) {
    logger?.warn(
      `ZCode MCP server "${serverName}": dropping zcodeOauth, as the ${type} flow requires ${missing.join(", ")}.`,
    );
    return undefined;
  }
  const allowed = new Set([...flow.required, ...flow.optional]);
  const oauth: Record<string, unknown> = { type };
  const ignored: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (key === "type" || PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    if (allowed.has(key) && typeof entry === "string") {
      oauth[key] = entry;
    } else {
      ignored.push(key);
    }
  }
  if (ignored.length > 0) {
    logger?.warn(
      `ZCode MCP server "${serverName}": ignoring zcodeOauth keys the ${type} flow does not accept: ${ignored.join(", ")}.`,
    );
  }
  return oauth;
}

/**
 * The `zcodeOauth` a server was authored with. `getMcpServers()` strips it, so
 * the authored server (`rawServerOf`) is consulted first.
 */
function authoredZcodeOauth({
  name,
  config,
  rawServerOf,
}: {
  name: string;
  config: Record<string, unknown>;
  rawServerOf?: (name: string) => unknown;
}): unknown {
  const raw = rawServerOf?.(name);
  return isRecord(raw) ? raw[ZCODE_OAUTH_CANONICAL_KEY] : config[ZCODE_OAUTH_CANONICAL_KEY];
}

function isPositiveMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Resolve ZCode's per-server `timeoutMs` (a positive number of milliseconds):
 * a valid explicit `timeoutMs` wins, otherwise the canonical `timeout`
 * (milliseconds, the `gitlabduo-mcp.ts` precedent) is used. A value ZCode
 * would reject is dropped with a warning instead of making ZCode skip the
 * server.
 */
function resolveZcodeTimeoutMs({
  serverName,
  config,
  logger,
}: {
  serverName: string;
  config: Record<string, unknown>;
  logger?: Logger;
}): number | undefined {
  const { timeoutMs, timeout } = config;
  if (timeoutMs !== undefined) {
    if (isPositiveMs(timeoutMs)) return timeoutMs;
    logger?.warn(
      `ZCode MCP server "${serverName}": ignoring timeoutMs ${JSON.stringify(timeoutMs)}, as it must be a positive number of milliseconds.`,
    );
  }
  if (timeout === undefined) return undefined;
  if (isPositiveMs(timeout)) return timeout;
  logger?.warn(
    `ZCode MCP server "${serverName}": dropping timeout ${JSON.stringify(timeout)}, as timeoutMs must be a positive number of milliseconds.`,
  );
  return undefined;
}

/**
 * The per-server keys ZCode reads on every transport: `timeoutMs`,
 * `protocolVersion`, `alwaysLoad` and the enable toggle (`enableKey`).
 *
 * `alwaysLoad` (added in 3.16.2 alongside tool search) keeps a server's tools
 * loaded up front instead of deferring them behind tool search. ZCode's schema
 * types it as a boolean, so any other value is dropped with a warning.
 */
function toZcodeCommonKeys({
  serverName,
  config,
  enableKey,
  logger,
}: {
  serverName: string;
  config: Record<string, unknown>;
  enableKey: string;
  logger?: Logger;
}): Record<string, unknown> {
  const common: Record<string, unknown> = {};
  const timeoutMs = resolveZcodeTimeoutMs({ serverName, config, logger });
  if (timeoutMs !== undefined) {
    common.timeoutMs = timeoutMs;
  }
  const { protocolVersion } = config;
  if (ZCODE_PROTOCOL_VERSIONS.has(protocolVersion)) {
    common.protocolVersion = protocolVersion;
  } else if (protocolVersion !== undefined) {
    logger?.warn(
      `ZCode MCP server "${serverName}": dropping protocolVersion ${JSON.stringify(protocolVersion)}, as ZCode accepts only ${[...ZCODE_PROTOCOL_VERSIONS].map((v) => JSON.stringify(v)).join(", ")}.`,
    );
  }
  const { alwaysLoad } = config;
  if (typeof alwaysLoad === "boolean") {
    common.alwaysLoad = alwaysLoad;
  } else if (alwaysLoad !== undefined) {
    logger?.warn(
      `ZCode MCP server "${serverName}": dropping alwaysLoad ${JSON.stringify(alwaysLoad)}, as it must be a boolean.`,
    );
  }
  if (config.disabled === true) {
    common[enableKey] = false;
  }
  return common;
}

/**
 * Convert canonical rulesync servers to ZCode's native `mcp.servers` shape:
 * stdio servers carry `command`/`args`/`env`, remote servers carry
 * `type` (`http` or `sse`), `url` and optional `headers`. A canonical
 * `disabled: true` maps to ZCode's `enable: false` (`enabled: false` in a
 * plugin's `.mcp.json`, via `enableKey`), which it defaults to `true` when
 * absent.
 *
 * Every server also carries `timeoutMs` (from the canonical `timeout`, or an
 * explicit `timeoutMs`), an allow-listed `protocolVersion` and a boolean
 * `alwaysLoad`; stdio servers carry `cwd`, and remote servers an `oauth` built
 * from the namespaced `zcodeOauth`. That key is stripped by `RulesyncMcp.getMcpServers()`, so it
 * is read from the authored server through `rawServerOf`. ZCode's docs do not
 * name these keys, so they follow the 3.14.3–3.16.2 runtime's per-server
 * schema, which is strict: an unknown key makes ZCode skip the server, which
 * is why the output stays a whitelist.
 *
 * @see https://zcode.z.ai/en/docs/mcp-services
 */
export function convertToZcodeFormat({
  mcpServers,
  logger,
  enableKey = "enable",
  rawServerOf,
}: {
  mcpServers: McpServers;
  logger?: Logger;
  enableKey?: string;
  rawServerOf?: (name: string) => unknown;
}): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (!isRecord(config)) continue;

    if (declaresNoTransport(config)) {
      warnAndSkipMcpServer({
        toolName: "ZCode",
        serverName: name,
        reason: "no transport",
        logger,
      });
      continue;
    }

    const converted: Record<string, unknown> = {};
    if (isRemoteMcpServer(config)) {
      const url = resolveRemoteMcpUrl(config);
      if (!url) {
        warnAndSkipMcpServer({
          toolName: "ZCode",
          serverName: name,
          reason: "a remote transport without a url",
          logger,
        });
        continue;
      }
      const stated = config.type ?? config.transport;
      // The remote transports ZCode's config is taken to accept, spelled the way it
      // writes them. ZCode's own MCP page documents remote servers only through its
      // UI ("Service URL" plus optional headers) and shows a JSON example for stdio
      // servers alone, so the `http`/`sse` spelling below is inferred from the JSON
      // Z.ai documents for the other MCP clients it supports rather than read off a
      // ZCode example. `streamable-http` is the canonical rulesync name for what
      // those configs call `http`; everything else is left to the caller to reject.
      //
      // @see https://zcode.z.ai/en/docs/mcp-services
      const type = resolveHttpOrSseRemoteType({ stated, url });
      if (type === undefined) {
        // Rewriting a WebSocket server as `http` would hand ZCode a server it
        // cannot connect to, so it is skipped out loud instead (the
        // rovodev/musecode precedent). The reason names what the entry actually
        // declared: with no `type`/`transport` of its own, it is the `ws(s)://`
        // url that ruled the server out.
        warnAndSkipMcpServer({
          toolName: "ZCode",
          serverName: name,
          reason:
            stated === undefined
              ? "a WebSocket url, which ZCode's remote transports (http and sse) cannot reach"
              : `the "${stated}" transport, which ZCode does not offer for remote servers (only http and sse)`,
          logger,
        });
        continue;
      }
      converted.type = type;
      converted.url = url;
      if (config.headers && Object.keys(config.headers).length > 0) {
        converted.headers = config.headers;
      }
      // The canonical (Claude Code-shaped) `oauth` is never copied: ZCode's
      // strict schema would reject it. Only `zcodeOauth` becomes `oauth`.
      const oauth = toZcodeOauth({
        serverName: name,
        value: authoredZcodeOauth({ name, config, rawServerOf }),
        logger,
      });
      if (oauth !== undefined) {
        converted.oauth = oauth;
      }
    } else {
      const commandArray = resolveLocalMcpCommand(config);
      const [command, ...args] = commandArray;
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "ZCode",
          serverName: name,
          reason: "a stdio transport without a command",
          logger,
        });
        continue;
      }
      converted.command = command;
      converted.args = args;
      if (config.env && Object.keys(config.env).length > 0) {
        converted.env = config.env;
      }
      if (typeof config.cwd === "string" && config.cwd !== "") {
        converted.cwd = config.cwd;
      }
    }
    result[name] = {
      ...converted,
      ...toZcodeCommonKeys({ serverName: name, config, enableKey, logger }),
    };
  }

  return result;
}

/**
 * ZCode's per-server enable toggle, in both spellings: the runtime normalizes
 * the legacy `enable` to `enabled`, and a plugin's `.mcp.json` uses `enabled`.
 */
const ZCODE_ENABLE_KEYS: ReadonlySet<string> = new Set(["enable", "enabled"]);

/**
 * Convert ZCode's native `mcp.servers` shape back to canonical rulesync
 * servers: `enable: false` / `enabled: false` map back to `disabled: true`,
 * and unknown keys pass through untouched so an import keeps whatever a
 * hand-authored entry declared. `timeoutMs` is lifted back into the canonical
 * `timeout` (milliseconds); when the server also states a `timeout`, ZCode
 * has already dropped that one, so `timeoutMs` replaces it. Any record
 * `oauth` is imported as the namespaced `zcodeOauth`, so a client secret is
 * never emitted to another tool. Generation back out is a whitelist, so only
 * the keys `convertToZcodeFormat` writes are re-emitted.
 *
 * An explicit `enable: true` is dropped rather than mapped to a canonical
 * `disabled: false`: absent already means enabled on both sides, so the flag
 * carries no information, and emitting it would push a redundant `disabled`
 * key into every other tool's generated config. (A canonical `enabled` is
 * rulesync's own generation filter, so it must never be passed through.)
 */
export function convertFromZcodeFormat({
  zcodeServers,
}: {
  zcodeServers: Record<string, unknown>;
}): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(zcodeServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (ZCODE_ENABLE_KEYS.has(key)) {
        if (value === false) {
          converted.disabled = true;
        }
        continue;
      }
      if (key === "timeoutMs" && typeof value === "number") {
        converted.timeout = value;
        continue;
      }
      if (key === "timeout" && typeof config.timeoutMs === "number") {
        continue;
      }
      // Every record `oauth` goes to the namespaced key, even one naming no
      // ZCode flow: it may still carry a client secret, and as canonical
      // `oauth` it would reach every other tool. Generation drops one that
      // names no flow, with a warning.
      if (key === "oauth" && isRecord(value)) {
        converted[ZCODE_OAUTH_CANONICAL_KEY] = value;
        continue;
      }
      converted[key] = value;
    }

    result[name] = converted;
  }

  return result;
}

/**
 * ZCode MCP servers.
 *
 * ZCode reads MCP servers from the `mcp.servers` block of its own config file:
 * `<project>/.zcode/config.json` at workspace scope and `~/.zcode/cli/config.json`
 * at user scope. The legacy `.agents/mcp.json` fallback is consulted only while
 * the `.zcode` file of the same scope lists no server, so rulesync writes the
 * native location and leaves the fallback alone. Sibling keys of `servers`
 * inside `mcp`, and every other top-level config key, are preserved; the file
 * is never deleted.
 *
 * @see https://zcode.z.ai/en/docs/mcp-services
 */
export class ZcodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseZcodeConfig(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // config.json is ZCode's primary config file, so it must never be removed
    // wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: global ? ZCODE_GLOBAL_CONFIG_DIR_PATH : ZCODE_DIR,
      relativeFilePath: ZCODE_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ZcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";

    return new ZcodeMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<ZcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseZcodeConfig(existingContent, filePath);

    const converted = convertToZcodeFormat({
      mcpServers: rulesyncMcp.getMcpServers(),
      logger,
      rawServerOf: (name) => rulesyncMcp.getRawMcpServer(name),
    });

    // `mcp` is owned as a whole key, so its non-`servers` siblings (e.g. a
    // `timeout` the user set) are carried over from the existing file before
    // the servers snapshot replaces `servers`.
    const existingMcp = isRecord(existing[ZCODE_MCP_CONFIG_KEY])
      ? existing[ZCODE_MCP_CONFIG_KEY]
      : {};

    return new ZcodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: {
          [ZCODE_MCP_CONFIG_KEY]: { ...existingMcp, [ZCODE_MCP_SERVERS_KEY]: converted },
        },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcp = isRecord(this.json[ZCODE_MCP_CONFIG_KEY]) ? this.json[ZCODE_MCP_CONFIG_KEY] : {};
    const servers = isRecord(mcp[ZCODE_MCP_SERVERS_KEY]) ? mcp[ZCODE_MCP_SERVERS_KEY] : {};
    const converted = convertFromZcodeFormat({ zcodeServers: servers });

    // Do not spread the full config JSON: ZCode's own keys (model, theme, ...)
    // must not leak into rulesync mcp.json.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: converted }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): ZcodeMcp {
    // The shared config file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new ZcodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(
        { [ZCODE_MCP_CONFIG_KEY]: { [ZCODE_MCP_SERVERS_KEY]: {} } },
        null,
        2,
      ),
      validate: false,
      global,
    });
  }
}
