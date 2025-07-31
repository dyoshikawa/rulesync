import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpServer } from "../../types/mcp-config.js";
import {
  configWrappers,
  generateMcpConfig,
  generateMcpConfigurationFiles,
  type McpServerMapping,
} from "./shared-factory.js";

type CodexServer = BaseMcpServer & {
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
};

export function generateCodexMcp(config: RulesyncMcpConfig): string {
  return generateMcpConfig(config, {
    target: "codexcli",
    configPaths: [
      "~/.codex/config.yaml",
      "~/.codex/config.json",
      ".codex/config.yaml",
      ".codex/config.json",
    ],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      // Since Codex CLI doesn't natively support MCP, we provide configuration
      // that would be used by an MCP wrapper server like openai-codex-mcp
      const codexServer: CodexServer = {};

      if (server.command) {
        codexServer.command = server.command;
        if (server.args) codexServer.args = server.args;
      } else if (server.url || server.httpUrl) {
        const url = server.httpUrl || server.url;
        if (url) {
          codexServer.url = url;
        }
        if (server.httpUrl) {
          codexServer.transport = "http";
        } else if (server.transport === "sse") {
          codexServer.transport = "sse";
        }
      }

      if (server.env) {
        codexServer.env = server.env;
      }

      // Add Codex CLI specific configuration
      if (server.cwd) {
        codexServer.workingDirectory = server.cwd;
      }

      return codexServer;
    },
    configWrapper: configWrappers.mcpServers,
  });
}

export function generateCodexMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFiles(
    mcpServers,
    {
      target: "codexcli",
      configPaths: [".codex/config.yaml", ".codex/config.json"],
      serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
        // Clone server config and remove targets
        const { targets: _, transport, ...serverConfig } = server;
        // Convert to CodexServer format preserving all properties
        const codexServer: CodexServer = { ...serverConfig };

        // Handle httpUrl by converting to url
        if (serverConfig.httpUrl !== undefined) {
          codexServer.url = serverConfig.httpUrl;
          delete codexServer.httpUrl;
        }

        // Set transport - Codex CLI MCP wrappers typically support stdio, sse, and http
        if (transport) {
          codexServer.transport = transport;
        } else {
          // Default to stdio for MCP wrapper servers
          codexServer.transport = "stdio";
        }

        // Note: Since Codex CLI doesn't directly support MCP, this configuration
        // is intended for use with MCP wrapper servers like openai-codex-mcp
        return codexServer;
      },
      configWrapper: (servers: Record<string, McpServerMapping>) => ({
        // Configuration format for MCP wrapper servers
        mcpServers: servers,
        // Add comment about usage
        _comment: "This configuration is for use with MCP wrapper servers like openai-codex-mcp",
      }),
    },
    baseDir,
  );
}
