import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

interface GeminiSettings {
  mcpServers: Record<string, GeminiServer>;
}

interface GeminiServer {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
  httpUrl?: string | undefined;
  env?: Record<string, string> | undefined;
  timeout?: number | undefined;
  trust?: boolean | undefined;
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
}

export function generateGeminiCliMcp(config: RulesyncMcpConfig): string {
  const geminiSettings: GeminiSettings = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldIncludeServer(server, "geminicli")) continue;

    const geminiServer: GeminiServer = {};

    if (server.command) {
      geminiServer.command = server.command;
      if (server.args) geminiServer.args = server.args;
    } else if (server.url || server.httpUrl) {
      if (server.httpUrl) {
        geminiServer.httpUrl = server.httpUrl;
      } else if (server.url) {
        geminiServer.url = server.url;
      }
    }

    if (server.env) {
      geminiServer.env = {};
      for (const [key, value] of Object.entries(server.env)) {
        if (value.startsWith("${") && value.endsWith("}")) {
          geminiServer.env[key] = value;
        } else {
          geminiServer.env[key] = `\${${value}}`;
        }
      }
    }

    if (server.timeout !== undefined) {
      geminiServer.timeout = server.timeout;
    }

    if (server.trust !== undefined) {
      geminiServer.trust = server.trust;
    }

    geminiSettings.mcpServers[serverName] = geminiServer;
  }

  return JSON.stringify(geminiSettings, null, 2);
}

export function generateGeminiCliMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const filepath = baseDir ? `${baseDir}/.gemini/settings.json` : ".gemini/settings.json";

  const config: GeminiSettings = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(mcpServers)) {
    // Check if this server should be included for geminicli
    if (!shouldIncludeServer(server, "geminicli")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _, ...serverConfig } = server;
    // Convert to GeminiServer format preserving all properties
    config.mcpServers[serverName] = { ...serverConfig };
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
  ];
}
