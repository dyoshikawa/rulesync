import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

interface RooConfig {
  mcpServers: Record<string, RooServer>;
}

interface RooServer {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
  env?: Record<string, string> | undefined;
  disabled?: boolean | undefined;
  alwaysAllow?: string[] | undefined;
  networkTimeout?: number | undefined;
  type?: "sse" | "streamable-http" | undefined;
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
}

export function generateRooMcp(config: RulesyncMcpConfig): string {
  const rooConfig: RooConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldIncludeServer(server, "roo")) continue;

    const rooServer: RooServer = {};

    if (server.command) {
      rooServer.command = server.command;
      if (server.args) rooServer.args = server.args;
    } else if (server.url || server.httpUrl) {
      const url = server.httpUrl || server.url;
      if (url) {
        rooServer.url = url;
      }
      if (server.httpUrl || server.transport === "http") {
        rooServer.type = "streamable-http";
      } else if (server.transport === "sse" || server.type === "sse") {
        rooServer.type = "sse";
      }
    }

    if (server.env) {
      rooServer.env = {};
      for (const [key, value] of Object.entries(server.env)) {
        if (value.startsWith("${env:") && value.endsWith("}")) {
          rooServer.env[key] = value;
        } else {
          rooServer.env[key] = `\${env:${value}}`;
        }
      }
    }

    if (server.disabled !== undefined) {
      rooServer.disabled = server.disabled;
    }

    if (server.alwaysAllow) {
      rooServer.alwaysAllow = server.alwaysAllow;
    }

    if (server.networkTimeout !== undefined) {
      rooServer.networkTimeout = Math.max(30000, Math.min(300000, server.networkTimeout));
    }

    rooConfig.mcpServers[serverName] = rooServer;
  }

  return JSON.stringify(rooConfig, null, 2);
}

export function generateRooMcpConfiguration(
  mcpServers: Record<string, unknown>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const filepath = baseDir ? `${baseDir}/.roo/mcp.json` : ".roo/mcp.json";

  const config: RooConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(mcpServers)) {
    // Type guard to ensure server is an object with relevant properties
    if (!server || typeof server !== "object") {
      continue;
    }
    const serverObj = server as RulesyncMcpServer;

    // Check if this server should be included for roo
    if (!shouldIncludeServer(serverObj, "roo")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _targets, ...serverConfig } = serverObj;

    // Convert to RooServer format preserving all properties
    const rooServer: RooServer = { ...serverConfig };

    // Handle httpUrl precedence over url
    if (serverConfig.httpUrl !== undefined && serverConfig.url !== undefined) {
      rooServer.url = serverConfig.httpUrl;
    }

    config.mcpServers[serverName] = rooServer;
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
  ];
}
