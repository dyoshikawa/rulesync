import { McpServers } from "../../types/mcp.js";
import type { Logger } from "../../utils/logger.js";

export type McpServerConfig = McpServers[string];

/**
 * A server that names no way to be reached at all. Kilo and OpenCode use this
 * shape for a bare `{"enabled": <bool>}` entry — a switch for a server another
 * config layer defines — so it is what such an entry imports as. Every other
 * tool's config defines the servers it lists, so there the entry has no
 * equivalent and must be skipped rather than written as an empty server.
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

const REMOTE_TRANSPORTS = new Set(["sse", "http", "streamable-http"]);

/**
 * Whether the server speaks over the network rather than over a spawned
 * process. `httpUrl` counts as much as `url` does — it is the field the Gemini
 * CLI adapter imports — and so does `transport`, the alias `type` has
 * everywhere else in the canonical config.
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
