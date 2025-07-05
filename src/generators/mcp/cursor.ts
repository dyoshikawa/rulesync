import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

interface CursorConfig {
  mcpServers: Record<string, CursorServer>;
}

interface CursorServer {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
  env?: Record<string, string> | undefined;
  cwd?: string | undefined;
  type?: "sse" | "streamable-http" | undefined;
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
}

export function generateCursorMcp(config: RulesyncMcpConfig): string {
  const cursorConfig: CursorConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldIncludeServer(server, "cursor")) continue;

    const cursorServer: CursorServer = {};

    if (server.command) {
      cursorServer.command = server.command;
      if (server.args) cursorServer.args = server.args;
    } else if (server.url || server.httpUrl) {
      const url = server.httpUrl || server.url;
      if (url) {
        cursorServer.url = url;
      }
      if (server.httpUrl || server.transport === "http") {
        cursorServer.type = "streamable-http";
      } else if (server.transport === "sse" || server.type === "sse") {
        cursorServer.type = "sse";
      }
    }

    if (server.env) {
      cursorServer.env = server.env;
    }

    if (server.cwd) {
      cursorServer.cwd = server.cwd;
    }

    cursorConfig.mcpServers[serverName] = cursorServer;
  }

  return JSON.stringify(cursorConfig, null, 2);
}

export function generateCursorMcpConfiguration(
  mcpServers: Record<string, unknown>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const filepath = baseDir ? `${baseDir}/.cursor/mcp.json` : ".cursor/mcp.json";

  const config: CursorConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(mcpServers)) {
    // Type guard to ensure server is an object with relevant properties
    if (!server || typeof server !== "object") {
      continue;
    }
    const serverObj = server as RulesyncMcpServer;

    // Check if this server should be included for cursor
    if (!shouldIncludeServer(serverObj, "cursor")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _targets, ...serverConfig } = serverObj;
    // Convert to CursorServer format preserving all properties
    const cursorServer: CursorServer = { ...serverConfig };

    // Handle httpUrl by converting to url
    if (serverConfig.httpUrl !== undefined) {
      cursorServer.url = serverConfig.httpUrl;
      delete cursorServer.httpUrl;
    }

    config.mcpServers[serverName] = cursorServer;
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
  ];
}
