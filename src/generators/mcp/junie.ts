import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpConfig, BaseMcpServer } from "../../types/mcp-config.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

type JunieServer = BaseMcpServer & {
  name?: string;
  workingDirectory?: string;
  transport?: "stdio" | "http" | "sse";
  [key: string]: unknown;
};

export function generateJunieMcp(config: RulesyncMcpConfig): string {
  const junieConfig: BaseMcpConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldIncludeServer(server, "junie")) continue;

    const junieServer: JunieServer = {
      name: serverName,
    };

    if (server.command) {
      junieServer.command = server.command;
      if (server.args) junieServer.args = server.args;
    } else if (server.url || server.httpUrl) {
      if (server.httpUrl) {
        junieServer.httpUrl = server.httpUrl;
      } else if (server.url) {
        junieServer.url = server.url;
      }
    }

    if (server.env) {
      junieServer.env = server.env;
    }

    if (server.cwd) {
      junieServer.workingDirectory = server.cwd;
    }

    if (server.timeout !== undefined) {
      junieServer.timeout = server.timeout;
    }

    if (server.trust !== undefined) {
      junieServer.trust = server.trust;
    }

    // Map transport types
    if (server.transport) {
      if (String(server.transport) === "streamable-http") {
        junieServer.transport = "http";
      } else if (
        server.transport === "stdio" ||
        server.transport === "http" ||
        server.transport === "sse"
      ) {
        junieServer.transport = server.transport;
      }
    } else if (server.command) {
      junieServer.transport = "stdio";
    }

    junieConfig.mcpServers[serverName] = junieServer;
  }

  return JSON.stringify(junieConfig, null, 2);
}

export function generateJunieMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  // Generate project-level configuration only (as per precautions.md constraint)
  // Junie MCP config is stored in project root - no IDE settings path is used
  // to avoid creating user-level settings
  const filepath = baseDir ? `${baseDir}/.junie/mcp-config.json` : ".junie/mcp-config.json";

  const config: BaseMcpConfig = {
    mcpServers: {},
  };

  for (const [serverName, server] of Object.entries(mcpServers)) {
    // Check if this server should be included for junie
    if (!shouldIncludeServer(server, "junie")) {
      continue;
    }

    // Clone server config and remove targets
    const { targets: _, transport, cwd, ...serverConfig } = server;

    // Convert to JunieServer format preserving all properties
    const junieServer: JunieServer = {
      ...serverConfig,
      name: serverName,
    };

    // Map cwd to workingDirectory
    if (cwd) {
      junieServer.workingDirectory = cwd;
    }

    // Map transport types for Junie compatibility
    if (transport) {
      if (String(transport) === "streamable-http") {
        junieServer.transport = "http";
      } else if (transport === "stdio" || transport === "http" || transport === "sse") {
        junieServer.transport = transport;
      }
    } else if (serverConfig.command) {
      junieServer.transport = "stdio";
    }

    config.mcpServers[serverName] = junieServer;
  }

  return [
    {
      filepath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
  ];
}
