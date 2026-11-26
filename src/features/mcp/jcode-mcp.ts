import { join } from "node:path";

import { JCODE_DIR, JCODE_MCP_FILE_NAME } from "../../constants/jcode-paths.js";
import type { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfigFile,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

/** The canonical server-map key, which jcode accepts as an alias. */
const MCP_SERVERS_KEY = "mcpServers";
/** jcode's historical server-map key, which `jcode mcp` itself writes. */
const LEGACY_SERVERS_KEY = "servers";

/**
 * The per-server keys rulesync writes and therefore owns: they are replaced
 * from the sources on every generate. Any other key of an existing server
 * entry (`shared`, `timeout_secs`, ...) is kept. `enabled` is owned too, since
 * import folds it into the canonical `disabled`.
 * @see https://github.com/1jehuang/jcode/blob/master/crates/jcode-base/src/mcp/protocol.rs
 */
const MANAGED_SERVER_KEYS: ReadonlySet<string> = new Set([
  "command",
  "args",
  "env",
  "type",
  "url",
  "headers",
  "disabled",
  "enabled",
]);

/**
 * Canonical keys that are handled elsewhere: converted here
 * (`httpUrl`, `transport`) or reported by the processor (tool filters).
 */
const CANONICAL_KEYS_NOT_REPORTED: ReadonlySet<string> = new Set([
  ...MANAGED_SERVER_KEYS,
  "httpUrl",
  "transport",
  "enabledTools",
  "disabledTools",
]);

/** `type` values jcode runs. Anything else (`ws`) is not run by jcode. */
const REMOTE_TYPES: ReadonlySet<string> = new Set(["http", "streamable-http", "sse"]);
const STDIO_TYPES: ReadonlySet<string> = new Set(["stdio", "local"]);

const EMPTY_MCP_CONFIG = "{}";

function parseJcodeMcpConfig({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  return parseSharedConfigFile({
    fileKey: sharedConfigFileKey({
      relativeDirPath: JCODE_DIR,
      relativeFilePath: JCODE_MCP_FILE_NAME,
    }),
    fileContent: fileContent || EMPTY_MCP_CONFIG,
    filePath: relativePath,
  });
}

/**
 * The server map of a jcode MCP file and the key it lives under. jcode reads
 * `mcpServers` as an alias of `servers` and fails to load a file that has
 * both, so whichever one the file already uses is kept. A file that has both
 * anyway is read as their union (`mcpServers` winning a name clash), with a
 * warning, and is written back under `mcpServers` alone.
 */
function readServerMap({
  json,
  relativePath,
  logger,
}: {
  json: Record<string, unknown>;
  relativePath: string;
  logger?: Logger;
}): {
  key: typeof MCP_SERVERS_KEY | typeof LEGACY_SERVERS_KEY;
  servers: Record<string, unknown>;
} {
  const modern = isPlainObject(json[MCP_SERVERS_KEY]) ? json[MCP_SERVERS_KEY] : undefined;
  const legacy = isPlainObject(json[LEGACY_SERVERS_KEY]) ? json[LEGACY_SERVERS_KEY] : undefined;
  if (modern && legacy) {
    logger?.warn(
      `${relativePath} has both "mcpServers" and "servers", which jcode refuses to load; reading both (mcpServers wins a name clash) and writing "mcpServers" only.`,
    );
    return { key: MCP_SERVERS_KEY, servers: { ...legacy, ...modern } };
  }
  if (legacy) return { key: LEGACY_SERVERS_KEY, servers: legacy };
  return { key: MCP_SERVERS_KEY, servers: modern ?? {} };
}

/**
 * Normalize a transport name the way jcode reads it: trimmed and
 * case-insensitive, with `streamable_http` / `streamablehttp` as spellings of
 * `streamable-http`.
 * @see https://github.com/1jehuang/jcode/blob/master/crates/jcode-base/src/mcp/protocol.rs
 */
function normalizeJcodeType(raw: string): string {
  const type = raw.trim().toLowerCase();
  return type === "streamable_http" || type === "streamablehttp" ? "streamable-http" : type;
}

/** `type` values jcode reads, after {@link normalizeJcodeType}. */
const JCODE_TYPES: ReadonlySet<string> = new Set(["stdio", "http", "streamable-http", "sse"]);

/** The canonical transport and URL of a server (`transport` / `httpUrl` folded in). */
function readTransport(server: Record<string, unknown>): {
  type: string | undefined;
  url: string | undefined;
} {
  const rawType = typeof server.type === "string" ? server.type : server.transport;
  const httpUrl = typeof server.httpUrl === "string" ? server.httpUrl : undefined;
  return {
    type:
      typeof rawType === "string" && rawType.trim() !== ""
        ? normalizeJcodeType(rawType)
        : undefined,
    url: typeof server.url === "string" ? server.url : httpUrl,
  };
}

/** The stdio command and argv; an array `command` is split into `command` and leading `args`. */
function readCommand(server: Record<string, unknown>): {
  command: string | undefined;
  args: string[];
} {
  const args = Array.isArray(server.args)
    ? server.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  if (typeof server.command === "string") {
    return { command: server.command === "" ? undefined : server.command, args };
  }
  if (!Array.isArray(server.command)) {
    return { command: undefined, args };
  }
  const [first, ...rest] = server.command.filter(
    (part): part is string => typeof part === "string",
  );
  return { command: first, args: [...rest, ...args] };
}

/**
 * Why jcode cannot run a server, or `undefined` when it can. `remote` says
 * which shape the server takes.
 */
function unsupportedServerReason({
  type,
  remote,
  url,
  command,
}: {
  type: string | undefined;
  remote: boolean;
  url: string | undefined;
  command: string | undefined;
}): string | undefined {
  if (type !== undefined && !REMOTE_TYPES.has(type) && !STDIO_TYPES.has(type)) {
    return `transport "${type}" is not supported (jcode runs stdio, "http"/"streamable-http" and "sse" servers)`;
  }
  if (remote && url === undefined) return "it has neither a command nor a URL";
  if (!remote && command === undefined) return "a stdio server needs a command";
  return undefined;
}

/**
 * Convert one canonical server into jcode's shape, or `undefined` when jcode
 * cannot run it.
 */
function toJcodeServer({
  serverName,
  server,
  logger,
}: {
  serverName: string;
  server: Record<string, unknown>;
  logger?: Logger;
}): Record<string, unknown> | undefined {
  const { type, url } = readTransport(server);
  const { command, args } = readCommand(server);
  const remote = type !== undefined ? REMOTE_TYPES.has(type) : command === undefined;
  const reason = unsupportedServerReason({ type, remote, url, command });
  if (reason !== undefined) {
    logger?.warn(`Skipping MCP server "${serverName}" for jcode: ${reason}.`);
    return undefined;
  }

  const dropped = Object.keys(server).filter((key) => !CANONICAL_KEYS_NOT_REPORTED.has(key));
  if (dropped.length > 0) {
    logger?.warn(
      `jcode does not support ${dropped.map((key) => `"${key}"`).join(", ")} on MCP server "${serverName}"; ${dropped.length === 1 ? "it is" : "they are"} not written.`,
    );
  }

  // jcode treats a URL entry without a type as Streamable HTTP, so the type is
  // written only when the source states one.
  const result: Record<string, unknown> = remote
    ? {
        ...(type !== undefined && { type }),
        url,
        ...(isPlainObject(server.headers) && { headers: server.headers }),
      }
    : {
        command,
        ...(args.length > 0 && { args }),
        ...(isPlainObject(server.env) && { env: server.env }),
      };
  if (typeof server.disabled === "boolean") result.disabled = server.disabled;
  return result;
}

/**
 * Merge a generated server over the entry of the same name already in the
 * file: the keys rulesync manages come from the sources, everything else the
 * entry carries (`shared`, `timeout_secs`, keys jcode adds later) is kept.
 */
function mergeServerEntry({
  existing,
  generated,
}: {
  existing: unknown;
  generated: Record<string, unknown>;
}): Record<string, unknown> {
  if (!isPlainObject(existing)) return generated;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (MANAGED_SERVER_KEYS.has(key) || PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    kept[key] = value;
  }
  return { ...kept, ...generated };
}

/** Read jcode's server map back into the canonical shape. */
function fromJcodeServers(servers: Record<string, unknown>): McpServers {
  const result: McpServers = {};
  for (const [serverName, raw] of Object.entries(servers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isPlainObject(raw)) continue;
    const entry = omitPrototypePollutionKeys(raw);
    const server: Record<string, unknown> = {};
    if (typeof entry.type === "string" && entry.type.trim() !== "") {
      const type = normalizeJcodeType(entry.type);
      // jcode does not run an entry with any other type, so it is not imported
      // as a server other tools would start.
      if (!JCODE_TYPES.has(type)) continue;
      server.type = type;
    }
    if (typeof entry.command === "string" && entry.command !== "") server.command = entry.command;
    if (Array.isArray(entry.args) && entry.args.length > 0) server.args = entry.args;
    if (isPlainObject(entry.env) && Object.keys(entry.env).length > 0) server.env = entry.env;
    if (typeof entry.url === "string") server.url = entry.url;
    if (isPlainObject(entry.headers) && Object.keys(entry.headers).length > 0) {
      server.headers = entry.headers;
    }
    // jcode's `disabled` (Claude Code style) wins over `enabled` (opencode style).
    if (typeof entry.disabled === "boolean") {
      server.disabled = entry.disabled;
    } else if (entry.enabled === false) {
      server.disabled = true;
    }
    result[serverName] = server;
  }
  return result;
}

/**
 * jcode MCP configuration.
 *
 * jcode reads `~/.jcode/mcp.json` (global) and, per project, `.jcode/mcp.json`
 * first, then `.mcp.json` and `.claude/mcp.json`, later files overriding
 * same-named servers. rulesync writes the jcode-owned `.jcode/mcp.json` in
 * project scope and `~/.jcode/mcp.json` in global scope. Servers keep the
 * Claude Code spelling jcode accepts (`command` / `args` / `env` for stdio,
 * `type` / `url` / `headers` for Streamable HTTP and SSE, plus `disabled`).
 *
 * jcode's own `jcode mcp` commands rewrite these files, so only the server map
 * is touched: other top-level keys are kept, and so are keys rulesync does not
 * manage on an existing server entry (`shared`, `timeout_secs`, ...). The
 * file is never deleted by `--delete`, since `jcode mcp add` writes it too.
 *
 * @see https://github.com/1jehuang/jcode/blob/master/docs/MCP_REMOTE.md
 * @see https://github.com/1jehuang/jcode/blob/master/crates/jcode-base/src/mcp/protocol.rs
 */
export class JcodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseJcodeMcpConfig({
      fileContent: this.fileContent,
      relativePath: join(this.relativeDirPath, this.relativeFilePath),
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // `jcode mcp add` writes these files too, so neither scope is deleted.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // The same relative path in both scopes; the processor supplies the home
    // directory as outputRoot in global mode.
    return { relativeDirPath: JCODE_DIR, relativeFilePath: JCODE_MCP_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<JcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? EMPTY_MCP_CONFIG;
    return new JcodeMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<JcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const relativePath = join(paths.relativeDirPath, paths.relativeFilePath);
    const filePath = join(outputRoot, relativePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later.
    const existingContent = (await readFileContentOrNull(filePath)) ?? EMPTY_MCP_CONFIG;
    const existing = readServerMap({
      json: parseJcodeMcpConfig({ fileContent: existingContent, relativePath }),
      relativePath,
      logger,
    });

    const servers: Record<string, unknown> = {};
    for (const [serverName, server] of Object.entries(rulesyncMcp.getMcpServers())) {
      if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isPlainObject(server)) continue;
      const generated = toJcodeServer({ serverName, server, logger });
      if (generated === undefined) continue;
      servers[serverName] = mergeServerEntry({
        existing: existing.servers[serverName],
        generated,
      });
    }

    const otherKey = existing.key === MCP_SERVERS_KEY ? LEGACY_SERVERS_KEY : MCP_SERVERS_KEY;
    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "mcp",
      existingContent,
      patch: {
        [existing.key]: servers,
        // Never both keys: jcode refuses a file that has both.
        [otherKey]: undefined,
      },
      filePath: relativePath,
    });

    return new JcodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = fromJcodeServers(
      readServerMap({
        json: this.json,
        relativePath: join(this.relativeDirPath, this.relativeFilePath),
      }).servers,
    );
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): JcodeMcp {
    return new JcodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: EMPTY_MCP_CONFIG,
      validate: false,
      global,
    });
  }
}
