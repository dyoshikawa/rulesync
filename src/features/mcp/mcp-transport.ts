import { McpServers } from "../../types/mcp.js";
import type { Logger } from "../../utils/logger.js";

export type McpServerConfig = McpServers[string];

/**
 * A server that names no way to be reached at all. It is what a Kilo bare
 * `{"enabled": <bool>}` entry imports as — a switch for a server another config
 * layer defines, which only Kilo's config spells this way. Every other tool's
 * config defines the servers it lists, so there the entry has no equivalent and
 * must be skipped rather than written as a server with an empty command.
 */
export function declaresNoTransport(serverConfig: McpServerConfig): boolean {
  return (
    serverConfig.type === undefined &&
    serverConfig.transport === undefined &&
    serverConfig.command === undefined &&
    serverConfig.url === undefined &&
    serverConfig.httpUrl === undefined
  );
}

// `ws` is here because it is reached by URL like the rest, even though no
// adapter using this module speaks WebSocket; classifying it as local would
// have such a server skipped for "no command", which is not why it cannot be
// written.
const REMOTE_TRANSPORTS = new Set(["sse", "http", "streamable-http", "ws"]);

/**
 * Whether the server speaks over the network rather than over a spawned
 * process. `httpUrl`, the Claude-specific alias several adapters accept, counts
 * as much as `url` does, and so does `transport`, the alias `type` has
 * everywhere in the canonical config.
 */
export function isRemoteMcpServer(serverConfig: McpServerConfig): boolean {
  return (
    REMOTE_TRANSPORTS.has(serverConfig.type ?? "") ||
    REMOTE_TRANSPORTS.has(serverConfig.transport ?? "") ||
    serverConfig.url !== undefined ||
    serverConfig.httpUrl !== undefined
  );
}

/** The URL a remote server is reached at, or `undefined` if it states none. */
export function resolveRemoteMcpUrl(serverConfig: McpServerConfig): string | undefined {
  return serverConfig.url || serverConfig.httpUrl || undefined;
}

/** The `command` array a `local` server is spawned with, `args` merged in. */
export function resolveLocalMcpCommand(serverConfig: McpServerConfig): string[] {
  const commandArray: string[] = [];
  if (serverConfig.command) {
    if (Array.isArray(serverConfig.command)) {
      commandArray.push(...serverConfig.command);
    } else {
      commandArray.push(serverConfig.command);
    }
  }
  if (serverConfig.args) {
    commandArray.push(...serverConfig.args);
  }
  return commandArray;
}

/**
 * A server that names a transport but carries nothing to reach it — a `type`
 * with no `command`, an `http` with no `url` — has no form in a config that
 * spells the transport out. Writing `{type: "local", command: []}` for it would
 * give the tool a server it cannot start and the importer a file it cannot read
 * back, so it is skipped out loud instead.
 */
export function warnAndSkipMcpServer({
  toolName,
  serverName,
  reason,
  logger,
}: {
  toolName: string;
  serverName: string;
  reason: string;
  logger?: Logger;
}): null {
  logger?.warn(`${toolName} MCP: skipping "${serverName}" because it declares ${reason}.`);
  return null;
}
