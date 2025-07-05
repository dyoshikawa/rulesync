import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

interface ClaudeSettings {
  mcpServers?: Record<string, ClaudeServer>;
}

interface ClaudeServer {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
  env?: Record<string, string> | undefined;
  transport?: "sse" | "http" | undefined;
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
}

export function generateClaudeMcp(config: RulesyncMcpConfig): string {
  const claudeSettings: ClaudeSettings = {
    mcpServers: {},
  };

  const shouldInclude = (server: RulesyncMcpServer): boolean => {
    return shouldIncludeServer(server, "claudecode");
  };

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldInclude(server)) continue;

    const claudeServer: ClaudeServer = {};

    if (server.command) {
      claudeServer.command = server.command;
      if (server.args) claudeServer.args = server.args;
    } else if (server.url || server.httpUrl) {
      const url = server.httpUrl || server.url;
      if (url) {
        claudeServer.url = url;
      }
      if (server.httpUrl) {
        claudeServer.transport = "http";
      } else if (server.transport === "sse") {
        claudeServer.transport = "sse";
      }
    }

    if (server.env) {
      claudeServer.env = server.env;
    }

    claudeSettings.mcpServers![serverName] = claudeServer;
  }

  return JSON.stringify(claudeSettings, null, 2);
}

export function generateClaudeMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const filepath = baseDir ? `${baseDir}/.claude/settings.json` : ".claude/settings.json";

  const settings: ClaudeSettings = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(mcpServers)) {
    // Check if this server should be included for claude
    if (!shouldIncludeServer(server, "claudecode")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _, transport, ...serverConfig } = server;
    // Convert to ClaudeServer format preserving all properties
    const claudeServer: ClaudeServer = { ...serverConfig };

    // Handle httpUrl by converting to url
    if (serverConfig.httpUrl !== undefined) {
      claudeServer.url = serverConfig.httpUrl;
      delete claudeServer.httpUrl;
    }

    // Only add transport if it's supported by Claude
    if (transport && transport !== "stdio" && (transport === "sse" || transport === "http")) {
      claudeServer.transport = transport;
    }

    settings.mcpServers![serverName] = claudeServer;
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(settings, null, 2)}\n`,
    },
  ];
}
