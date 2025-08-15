import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpServer, KiroConfig } from "../../types/mcp-config.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

type KiroServer = Omit<BaseMcpServer, "transport"> & {
  // Allow additional properties that might be present in the server config
  transport?: "stdio" | "sse" | "http" | "streamable-http" | undefined;
  [key: string]: unknown;
};

export function generateKiroMcp(config: RulesyncMcpConfig): string {
  const kiroConfig: KiroConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldIncludeServer(server, "kiro")) continue;

    const kiroServer: KiroServer = {};

    if (server.command) {
      kiroServer.command = server.command;
      if (server.args) kiroServer.args = server.args;
    } else if (server.url || server.httpUrl) {
      const url = server.httpUrl || server.url;
      if (url) {
        kiroServer.url = url;
      }
      if (server.httpUrl || server.transport === "http") {
        kiroServer.transport = "streamable-http";
      } else if (server.transport === "sse" || server.type === "sse") {
        kiroServer.transport = "sse";
      }
    }

    if (server.env) {
      kiroServer.env = server.env;
    }

    if (server.timeout) {
      kiroServer.timeout = server.timeout;
    }

    if (server.disabled !== undefined) {
      kiroServer.disabled = server.disabled;
    }

    if (server.transport) {
      kiroServer.transport = server.transport;
    }

    // Handle Kiro-specific fields
    if (server.kiroAutoApprove) {
      kiroServer.autoApprove = server.kiroAutoApprove;
    }

    if (server.kiroAutoBlock) {
      kiroServer.autoBlock = server.kiroAutoBlock;
    }

    kiroConfig.mcpServers[serverName] = kiroServer;
  }

  return JSON.stringify(kiroConfig, null, 2);
}

export function generateKiroMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const filepath = baseDir ? `${baseDir}/.kiro/mcp.json` : ".kiro/mcp.json";

  const config: KiroConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(mcpServers)) {
    // Check if this server should be included for kiro
    if (!shouldIncludeServer(server, "kiro")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _targets, ...serverConfig } = server;
    // Convert to KiroServer format preserving all properties
    const kiroServer: KiroServer = { ...serverConfig };

    // Handle httpUrl by converting to url
    if (serverConfig.httpUrl !== undefined) {
      kiroServer.url = serverConfig.httpUrl;
      delete kiroServer.httpUrl;
    }

    // Handle Kiro-specific fields
    if (serverConfig.kiroAutoApprove !== undefined) {
      kiroServer.autoApprove = serverConfig.kiroAutoApprove;
      delete kiroServer.kiroAutoApprove;
    }

    if (serverConfig.kiroAutoBlock !== undefined) {
      kiroServer.autoBlock = serverConfig.kiroAutoBlock;
      delete kiroServer.kiroAutoBlock;
    }

    config.mcpServers[serverName] = kiroServer;
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
  ];
}
