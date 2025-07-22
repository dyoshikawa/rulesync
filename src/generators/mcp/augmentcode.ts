import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

interface AugmentSettings {
  mcpServers?: AugmentServer[];
}

interface AugmentServer {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  transport?: "sse" | "http";
  headers?: Record<string, string>;
  env?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
  retries?: number;
}

export function generateAugmentcodeMcp(config: RulesyncMcpConfig): string {
  const augmentSettings: AugmentSettings = {
    mcpServers: [],
  };

  const shouldInclude = (server: RulesyncMcpServer): boolean => {
    return shouldIncludeServer(server, "augmentcode");
  };

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldInclude(server)) continue;

    const augmentServer: AugmentServer = {
      name: serverName,
    };

    // Handle STDIO transport
    if (server.command) {
      augmentServer.command = server.command;
      if (server.args) {
        augmentServer.args = server.args;
      }
    }
    // Handle remote transports (SSE/HTTP)
    else if (server.url || server.httpUrl) {
      const url = server.httpUrl || server.url;
      if (url) {
        augmentServer.url = url;
      }

      // Set transport type based on configuration
      if (server.httpUrl || server.transport === "http") {
        augmentServer.transport = "http";
      } else if (server.transport === "sse") {
        augmentServer.transport = "sse";
      }

      // Add headers if present
      if (server.env) {
        // For remote servers, env variables are typically passed as headers
        augmentServer.headers = server.env;
      }
    }

    // Add environment variables for STDIO servers
    if (server.env && server.command) {
      augmentServer.env = server.env;
    }

    // Add optional fields
    if (server.timeout) {
      augmentServer.timeout = server.timeout;
    }

    // Map disabled to enabled (inverted)
    if (server.disabled !== undefined) {
      augmentServer.enabled = !server.disabled;
    }

    // Add retries if specified
    if (server.networkTimeout && server.networkTimeout > 0) {
      // Convert networkTimeout to retries approximation
      augmentServer.retries = Math.max(1, Math.floor(server.networkTimeout / 30000));
    }

    if (augmentSettings.mcpServers) {
      augmentSettings.mcpServers.push(augmentServer);
    }
  }

  return JSON.stringify(augmentSettings, null, 2);
}

export function generateAugmentcodeMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const filepath = baseDir ? `${baseDir}/.mcp.json` : ".mcp.json";

  const settings: { mcpServers: Record<string, Omit<AugmentServer, "name">> } = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(mcpServers)) {
    // Check if this server should be included for augmentcode
    if (!shouldIncludeServer(server, "augmentcode")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _, ...serverConfig } = server;
    const augmentServer: Omit<AugmentServer, "name"> = {};

    // Handle STDIO transport
    if (serverConfig.command) {
      augmentServer.command = serverConfig.command;
      if (serverConfig.args) {
        augmentServer.args = serverConfig.args;
      }
      if (serverConfig.env) {
        augmentServer.env = serverConfig.env;
      }
    }
    // Handle remote transports
    else if (serverConfig.url || serverConfig.httpUrl) {
      const url = serverConfig.httpUrl || serverConfig.url;
      if (url) {
        augmentServer.url = url;
      }

      // Set transport type
      if (serverConfig.httpUrl || serverConfig.transport === "http") {
        augmentServer.transport = "http";
      } else if (serverConfig.transport === "sse") {
        augmentServer.transport = "sse";
      }

      // For remote servers, env variables become headers
      if (serverConfig.env) {
        augmentServer.headers = serverConfig.env;
      }
    }

    // Add optional fields
    if (serverConfig.timeout) {
      augmentServer.timeout = serverConfig.timeout;
    }

    // Map disabled to enabled (inverted)
    if (serverConfig.disabled !== undefined) {
      augmentServer.enabled = !serverConfig.disabled;
    }

    // Add retries based on networkTimeout
    if (serverConfig.networkTimeout && serverConfig.networkTimeout > 0) {
      augmentServer.retries = Math.max(1, Math.floor(serverConfig.networkTimeout / 30000));
    }

    settings.mcpServers[serverName] = augmentServer;
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(settings, null, 2)}\n`,
    },
  ];
}
