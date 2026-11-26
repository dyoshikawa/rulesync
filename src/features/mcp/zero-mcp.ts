import { join } from "node:path";

import {
  ZERO_CONFIG_FILE_NAME,
  ZERO_DIR,
  ZERO_MCP_CONFIG_KEY,
  ZERO_MCP_SERVERS_KEY,
  zeroGlobalConfigDir,
  zeroOtherPlatformGlobalConfigDir,
} from "../../constants/zero-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfigFile,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { findServersWithEnvVarRefs } from "./mcp-env-var-format.js";
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

const TOOL_NAME = "Zero";

/**
 * Zero refuses every MCP server once one server name is invalid, so names
 * outside its pattern are skipped instead of written.
 * @see https://github.com/Twigpine/zero/blob/main/internal/mcp/permissions.go
 */
const ZERO_SERVER_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function copyStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      !PROTOTYPE_POLLUTION_KEYS.has(entry[0]) && typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** The namespaced canonical key that carries Zero's per-server `oauth`. */
const ZERO_OAUTH_CANONICAL_KEY = "zeroOauth";

/** Server keys rulesync writes itself, so an existing value never survives. */
const ZERO_MANAGED_SERVER_KEYS: ReadonlySet<string> = new Set([
  "type",
  "command",
  "args",
  "env",
  "url",
  "headers",
  "auth",
  "disabled",
]);

/**
 * Copy the keys of an existing same-named server that rulesync does not
 * manage (an `oauth` block written by `zero mcp`, a key a newer Zero reads)
 * onto the generated server. `oauth` is only kept on a remote server, since
 * Zero rejects it on a stdio one.
 */
function carryOverUnmanagedKeys({
  converted,
  existing,
}: {
  converted: Record<string, unknown>;
  existing: unknown;
}): void {
  if (!isRecord(existing)) return;
  for (const [key, value] of Object.entries(existing)) {
    if (
      PROTOTYPE_POLLUTION_KEYS.has(key) ||
      ZERO_MANAGED_SERVER_KEYS.has(key) ||
      Object.hasOwn(converted, key) ||
      (key === "oauth" && converted.type !== "http")
    ) {
      continue;
    }
    converted[key] = value;
  }
}

/**
 * Convert canonical rulesync servers to Zero's `mcp.servers` entries: stdio
 * servers carry `type: "stdio"`, `command`, `args` and `env`; remote servers
 * carry `type: "http"`, `url` and `headers`. Zero documents only these two
 * transports, so an SSE or WebSocket server is skipped with a warning. A
 * canonical `disabled: true` maps to Zero's `disabled: true`, and the
 * documented `auth: "oauth"` is kept on remote servers.
 *
 * Zero validates every server when it loads the config and refuses the whole
 * MCP setup on the first invalid one, so the output stays a whitelist of
 * documented keys (`cwd`, `timeout`, tool filters are not written). A remote
 * server's `oauth` block comes from the namespaced `zeroOauth` key (read from
 * the authored server, since `getMcpServers()` strips it). Keys rulesync does
 * not manage on a same-named server of the existing file (such as an `oauth`
 * block written by `zero mcp`) are carried over.
 *
 * @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md#5-mcp--model-context-protocol
 * @see https://github.com/Twigpine/zero/blob/main/internal/mcp/config.go
 */
export function convertToZeroFormat({
  mcpServers,
  logger,
  rawServerOf,
  existingServers = {},
}: {
  mcpServers: McpServers;
  logger?: Logger;
  rawServerOf?: (name: string) => unknown;
  existingServers?: Record<string, unknown>;
}): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    const skip = (reason: string): void => {
      warnAndSkipMcpServer({ toolName: TOOL_NAME, serverName: name, reason, logger });
    };

    if (!ZERO_SERVER_NAME_PATTERN.test(name)) {
      skip(
        "a name Zero rejects (use letters, numbers, dots, dashes or underscores), which would make Zero refuse every MCP server",
      );
      continue;
    }
    if (declaresNoTransport(config)) {
      skip("no transport");
      continue;
    }

    const converted = isRemoteMcpServer(config)
      ? toZeroRemoteServer({ config, skip })
      : toZeroStdioServer({ name, config, skip, logger });
    if (converted === undefined) continue;
    if (config.disabled === true) converted.disabled = true;
    if (converted.type === "http") {
      const raw = rawServerOf?.(name);
      const oauth = isRecord(raw)
        ? raw[ZERO_OAUTH_CANONICAL_KEY]
        : config[ZERO_OAUTH_CANONICAL_KEY];
      if (isRecord(oauth)) converted.oauth = oauth;
    }
    carryOverUnmanagedKeys({
      converted,
      existing: lookupOwn({ record: existingServers, key: name }),
    });
    result[name] = converted;
  }

  return result;
}

function toZeroRemoteServer({
  config,
  skip,
}: {
  config: McpServers[string];
  skip: (reason: string) => void;
}): Record<string, unknown> | undefined {
  const url = resolveRemoteMcpUrl(config);
  if (!url) {
    skip("a remote transport without a url");
    return undefined;
  }
  const stated = config.type ?? config.transport;
  const type = resolveHttpOrSseRemoteType({ stated, url });
  if (type !== "http") {
    skip(
      type === "sse"
        ? 'the "sse" transport, which Zero does not document (only stdio and http)'
        : stated === undefined
          ? "a WebSocket url, which Zero's documented remote transport (http) cannot reach"
          : `the "${stated}" transport, which Zero does not document (only stdio and http)`,
    );
    return undefined;
  }
  const converted: Record<string, unknown> = { type: "http", url };
  const headers = copyStringMap(config.headers);
  if (headers) converted.headers = headers;
  if (config.auth === "oauth") converted.auth = "oauth";
  return converted;
}

function toZeroStdioServer({
  name,
  config,
  skip,
  logger,
}: {
  name: string;
  config: McpServers[string];
  skip: (reason: string) => void;
  logger?: Logger;
}): Record<string, unknown> | undefined {
  const [command, ...args] = resolveLocalMcpCommand(config);
  if (!command) {
    skip("a stdio transport without a command");
    return undefined;
  }
  const converted: Record<string, unknown> = { type: "stdio", command };
  if (args.length > 0) converted.args = args;
  const env = copyStringMap(config.env);
  if (env) converted.env = env;
  if (typeof config.cwd === "string" && config.cwd !== "") {
    logger?.warn(
      `${TOOL_NAME} MCP server ${quoteValueForWarning(name)}: dropping cwd, which Zero's server config has no key for.`,
    );
  }
  return converted;
}

/**
 * Convert Zero's `mcp.servers` entries back to canonical rulesync servers.
 */
export function convertFromZeroFormat(servers: Record<string, unknown>): McpServers {
  const result: McpServers = {};
  for (const [name, config] of Object.entries(servers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    const server: Record<string, unknown> = {};
    const type = typeof config.type === "string" ? config.type.trim().toLowerCase() : undefined;
    if (typeof config.url === "string" && type !== "stdio") {
      server.type = type === "sse" ? "sse" : "http";
      server.url = config.url;
      const headers = copyStringMap(config.headers);
      if (headers) server.headers = headers;
      if (config.auth === "oauth") server.auth = "oauth";
      // Imported under the namespaced key so a client secret never reaches
      // another tool's config.
      if (isRecord(config.oauth)) server[ZERO_OAUTH_CANONICAL_KEY] = config.oauth;
    } else if (typeof config.command === "string") {
      server.type = "stdio";
      server.command = config.command;
      if (isStringArray(config.args) && config.args.length > 0) server.args = config.args;
      const env = copyStringMap(config.env);
      if (env) server.env = env;
    } else {
      continue;
    }
    if (config.disabled === true) server.disabled = true;
    result[name] = server;
  }
  return result;
}

/**
 * Zero MCP servers.
 *
 * Zero reads MCP servers from `mcp.servers` of its JSON config:
 * `.zero/config.json` (project) and `<user config dir>/zero/config.json`
 * (`~/.config/zero/config.json` on Linux and macOS, `%AppData%\zero\config.json`
 * on Windows). The file also holds provider, model and sandbox settings, so
 * rulesync replaces `mcp.servers` only, keeps every other key, refuses to
 * rewrite a file it cannot parse and never deletes the file.
 *
 * Zero sends config values verbatim (no `${env:...}` expansion), so
 * environment variable references are written literally, with a warning.
 *
 * @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md#5-mcp--model-context-protocol
 */
export class ZeroMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseSharedConfigFile({
      fileKey: sharedConfigFileKey(ZeroMcp.getSettablePaths({ global: this.global })),
      fileContent: this.fileContent ?? "",
      filePath: join(this.relativeDirPath, this.relativeFilePath),
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // config.json is Zero's primary config file, so it is never removed.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: global ? zeroGlobalConfigDir() : ZERO_DIR,
      relativeFilePath: ZERO_CONFIG_FILE_NAME,
    };
  }

  /** @see zeroOtherPlatformGlobalConfigDir */
  static getExtraSharedWritePaths({
    global = false,
  }: { global?: boolean } = {}): SharedWritePath[] {
    if (!global) {
      return [];
    }
    return [
      {
        relativeDirPath: zeroOtherPlatformGlobalConfigDir(),
        relativeFilePath: ZERO_CONFIG_FILE_NAME,
      },
    ];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ZeroMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";

    return new ZeroMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<ZeroMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseSharedConfigFile({
      fileKey: sharedConfigFileKey(paths),
      fileContent: existingContent,
      filePath,
    });

    const mcpServers = rulesyncMcp.getMcpServers();
    const withEnvRefs = findServersWithEnvVarRefs(mcpServers);
    if (withEnvRefs.length > 0) {
      logger?.warn(
        `${TOOL_NAME} MCP servers ${withEnvRefs.map((name) => quoteValueForWarning(name)).join(", ")} ` +
          "use environment variable references (${VAR}), which Zero does not expand; " +
          "they are written literally. Use a wrapper script or a secret manager instead.",
      );
    }
    // `mcp` is owned as a whole key, so any non-`servers` sibling is carried
    // over from the existing file before the servers snapshot replaces
    // `servers`.
    const existingMcp = isRecord(existing[ZERO_MCP_CONFIG_KEY])
      ? existing[ZERO_MCP_CONFIG_KEY]
      : {};
    const converted = convertToZeroFormat({
      mcpServers,
      logger,
      rawServerOf: (name) => rulesyncMcp.getRawMcpServer(name),
      existingServers: isRecord(existingMcp[ZERO_MCP_SERVERS_KEY])
        ? existingMcp[ZERO_MCP_SERVERS_KEY]
        : {},
    });

    return new ZeroMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: {
          [ZERO_MCP_CONFIG_KEY]: { ...existingMcp, [ZERO_MCP_SERVERS_KEY]: converted },
        },
        filePath,
        logger,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcp = isRecord(this.json[ZERO_MCP_CONFIG_KEY]) ? this.json[ZERO_MCP_CONFIG_KEY] : {};
    const servers = isRecord(mcp[ZERO_MCP_SERVERS_KEY]) ? mcp[ZERO_MCP_SERVERS_KEY] : {};

    // Never spread the config itself: provider settings and keys must not
    // leak into the rulesync source.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertFromZeroFormat(servers) }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): ZeroMcp {
    return new ZeroMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(
        { [ZERO_MCP_CONFIG_KEY]: { [ZERO_MCP_SERVERS_KEY]: {} } },
        null,
        2,
      ),
      validate: false,
      global,
    });
  }
}
