import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

interface RooConfig {
  mcpServers: Record<string, RooServer>;
}

interface RooServer {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
  alwaysAllow?: string[];
  networkTimeout?: number;
  type?: "sse" | "streamable-http";
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
    // Type guard to ensure server is an object
    if (!server || typeof server !== "object") {
      continue;
    }

    // Cast to RulesyncMcpServer after type check
    const serverObj = server as RulesyncMcpServer;

    // Check if this server should be included for roo
    if (!shouldIncludeServer(serverObj, "roo")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _targets, ...serverConfig } = serverObj;

    // Handle httpUrl precedence over url
    if (serverConfig.httpUrl && serverConfig.url) {
      serverConfig.url = serverConfig.httpUrl;
      delete serverConfig.httpUrl;
    }

    config.mcpServers[serverName] = serverConfig;
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
  ];
}
