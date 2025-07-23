import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpServer, ClineConfig } from "../../types/mcp-config.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

type ClineServer = BaseMcpServer & {
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
};

export function generateClineMcp(config: RulesyncMcpConfig): string {
  const clineConfig: ClineConfig = {
    mcpServers: {},
  };

  const shouldInclude = (server: RulesyncMcpServer): boolean => {
    return shouldIncludeServer(server, "cline");
  };

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldInclude(server)) continue;

    const clineServer: ClineServer = {};

    if (server.command) {
      clineServer.command = server.command;
      if (server.args) clineServer.args = server.args;
    } else if (server.url) {
      clineServer.url = server.url;
    }

    if (server.env) {
      clineServer.env = server.env;
    }

    if (server.disabled !== undefined) {
      clineServer.disabled = server.disabled;
    }

    if (server.alwaysAllow) {
      clineServer.alwaysAllow = server.alwaysAllow;
    }

    if (server.networkTimeout !== undefined) {
      clineServer.networkTimeout = server.networkTimeout;
    }

    clineConfig.mcpServers[serverName] = clineServer;
  }

  return JSON.stringify(clineConfig, null, 2);
}

export function generateClineMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const filepath = baseDir ? `${baseDir}/.cline/mcp.json` : ".cline/mcp.json";

  const config: ClineConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(mcpServers)) {
    // Check if this server should be included for cline
    if (!shouldIncludeServer(server, "cline")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _, ...serverConfig } = server;
    // Convert to ClineServer format preserving all properties
    config.mcpServers[serverName] = { ...serverConfig };
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
  ];
}
