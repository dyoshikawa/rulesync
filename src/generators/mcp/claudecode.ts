import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpServer } from "../../types/mcp-config.js";
import {
  configWrappers,
  generateMcpConfig,
  generateMcpConfigurationFiles,
  type McpServerMapping,
} from "./shared-factory.js";

type ClaudeServer = BaseMcpServer & {
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
};

export function generateClaudeMcp(config: RulesyncMcpConfig): string {
  return generateMcpConfig(config, {
    target: "claudecode",
    configPaths: [".claude/settings.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
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

      return claudeServer;
    },
    configWrapper: configWrappers.mcpServers,
  });
}

export function generateClaudeMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFiles(
    mcpServers,
    {
      target: "claudecode",
      configPaths: [".claude/settings.json"],
      serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
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

        return claudeServer;
      },
      configWrapper: configWrappers.mcpServers,
    },
    baseDir,
  );
}
