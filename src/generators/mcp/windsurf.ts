import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpServer } from "../../types/mcp-config.js";
import {
  configWrappers,
  generateMcpConfig,
  generateMcpConfigurationFiles,
  type McpServerMapping,
} from "./shared-factory.js";

type WindsurfServer = BaseMcpServer & {
  serverUrl?: string;
  [key: string]: unknown;
};

export function generateWindsurfMcp(config: RulesyncMcpConfig): string {
  return generateMcpConfig(config, {
    target: "windsurf",
    configPaths: ["mcp_config.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      const windsurfServer: WindsurfServer = {};

      if (server.command) {
        windsurfServer.command = server.command;
        if (server.args) windsurfServer.args = server.args;
      } else if (server.url || server.httpUrl) {
        // Windsurf uses serverUrl for both SSE and HTTP URLs
        const url = server.httpUrl || server.url;
        if (url) {
          windsurfServer.serverUrl = url;
        }
      }

      if (server.env) {
        windsurfServer.env = server.env;
      }

      if (server.cwd) {
        windsurfServer.cwd = server.cwd;
      }

      return windsurfServer;
    },
    configWrapper: configWrappers.mcpServers,
  });
}

export function generateWindsurfMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFiles(
    mcpServers,
    {
      target: "windsurf",
      configPaths: ["mcp_config.json"],
      serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
        const { targets: _, transport: _transport, ...serverConfig } = server;
        const windsurfServer: WindsurfServer = { ...serverConfig };

        // Handle httpUrl by converting to serverUrl
        if (serverConfig.httpUrl !== undefined) {
          windsurfServer.serverUrl = serverConfig.httpUrl;
          delete windsurfServer.httpUrl;
        }

        // Handle url by converting to serverUrl
        if (serverConfig.url !== undefined) {
          windsurfServer.serverUrl = serverConfig.url;
          delete windsurfServer.url;
        }

        return windsurfServer;
      },
      configWrapper: configWrappers.mcpServers,
    },
    baseDir,
  );
}
