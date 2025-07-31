import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpServer } from "../../types/mcp-config.js";
import {
  generateMcpConfig,
  generateMcpConfigurationFiles,
  type McpServerMapping,
} from "./shared-factory.js";

type CodexServer = BaseMcpServer & {
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
  // Codex CLI specific fields
  headers?: Record<string, string>;
  workingDirectory?: string;
};

export function generateCodexMcp(config: RulesyncMcpConfig): string {
  return generateMcpConfig(config, {
    target: "codexcli",
    configPaths: [".codex/mcp-config.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      // Configuration format for MCP wrapper servers that integrate with Codex CLI
      // This configuration is for third-party MCP servers like openai-codex-mcp
      const codexServer: CodexServer = {};

      // Handle transport and connection configuration
      if (server.command) {
        codexServer.command = server.command;
        if (server.args) codexServer.args = server.args;
        // Default to stdio for command-based servers
        codexServer.transport = server.transport || "stdio";
      } else if (server.url || server.httpUrl) {
        const url = server.httpUrl || server.url;
        if (url) {
          codexServer.url = url;
        }
        if (server.httpUrl) {
          codexServer.transport = "http";
        } else if (server.transport === "sse") {
          codexServer.transport = "sse";
        } else if (server.transport === "http") {
          codexServer.transport = "http";
        } else {
          codexServer.transport = "stdio";
        }
      } else {
        // Default transport for MCP wrapper servers
        codexServer.transport = "stdio";
      }

      // Environment variables - important for API keys and model configuration
      if (server.env) {
        codexServer.env = { ...server.env };

        // Ensure required Codex CLI environment variables have reasonable defaults
        if (!codexServer.env.CODEX_DEFAULT_MODEL) {
          codexServer.env.CODEX_DEFAULT_MODEL = "gpt-4o-mini";
        }
      }

      // Working directory configuration
      if (server.cwd) {
        codexServer.cwd = server.cwd;
        // Also set workingDirectory for compatibility
        codexServer.workingDirectory = server.cwd;
      }

      // Timeout configuration
      if (server.timeout) {
        codexServer.timeout = server.timeout;
      }

      // Headers for HTTP/SSE transports
      if (server.headers) {
        codexServer.headers = server.headers;
      }

      return codexServer;
    },
    configWrapper: (servers: Record<string, McpServerMapping>) => ({
      // Configuration format for MCP wrapper servers that expose Codex CLI functionality
      servers,
      _comment:
        "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
      _usage:
        "This file is intended for use with third-party MCP servers that wrap Codex CLI functionality",
      _examples: {
        python_server: "python -m mcp_server or uvicorn codex_server:app",
        nodejs_server: "node dist/server.js or npm start",
        docker_server: "docker run -i --rm custom/codex-mcp:latest",
      },
      _security_note: "Store API keys in environment variables, not in this configuration file",
    }),
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
      configPaths: [".codex/mcp-config.json"],
      serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
        // Clone server config and remove targets
        const { targets: _, transport, ...serverConfig } = server;
        // Convert to CodexServer format preserving all properties
        const codexServer: CodexServer = {};

        // Copy all properties explicitly to handle exactOptionalPropertyTypes
        if (serverConfig.command !== undefined) codexServer.command = serverConfig.command;
        if (serverConfig.args !== undefined) codexServer.args = serverConfig.args;
        if (serverConfig.url !== undefined) codexServer.url = serverConfig.url;
        if (serverConfig.httpUrl !== undefined) codexServer.httpUrl = serverConfig.httpUrl;
        if (serverConfig.env !== undefined) codexServer.env = serverConfig.env;
        if (serverConfig.disabled !== undefined) codexServer.disabled = serverConfig.disabled;
        if (serverConfig.networkTimeout !== undefined)
          codexServer.networkTimeout = serverConfig.networkTimeout;
        if (serverConfig.timeout !== undefined) codexServer.timeout = serverConfig.timeout;
        if (serverConfig.trust !== undefined) codexServer.trust = serverConfig.trust;
        if (serverConfig.cwd !== undefined) codexServer.cwd = serverConfig.cwd;
        if (serverConfig.type !== undefined) codexServer.type = serverConfig.type;
        if (serverConfig.alwaysAllow !== undefined)
          codexServer.alwaysAllow = serverConfig.alwaysAllow;
        if (serverConfig.tools !== undefined) codexServer.tools = serverConfig.tools;
        if (serverConfig.kiroAutoApprove !== undefined)
          codexServer.autoApprove = serverConfig.kiroAutoApprove;
        if (serverConfig.kiroAutoBlock !== undefined)
          codexServer.autoBlock = serverConfig.kiroAutoBlock;
        if (serverConfig.headers !== undefined) codexServer.headers = serverConfig.headers;

        // Handle httpUrl by converting to url
        if (serverConfig.httpUrl !== undefined) {
          codexServer.url = serverConfig.httpUrl;
          delete codexServer.httpUrl;
        }

        // Set transport - MCP wrapper servers support stdio, sse, and http
        if (transport) {
          codexServer.transport = transport;
        } else if (serverConfig.url && !serverConfig.httpUrl) {
          // If only url is specified without transport, default depends on the context
          codexServer.transport = "sse";
        } else {
          // Default to stdio for MCP wrapper servers
          codexServer.transport = "stdio";
        }

        // Environment variables with defaults
        if (serverConfig.env) {
          codexServer.env = { ...serverConfig.env };

          // Ensure required Codex CLI environment variables have reasonable defaults
          if (!codexServer.env.CODEX_DEFAULT_MODEL) {
            codexServer.env.CODEX_DEFAULT_MODEL = "gpt-4o-mini";
          }
        }

        // Working directory configuration
        if (serverConfig.cwd) {
          codexServer.cwd = serverConfig.cwd;
          codexServer.workingDirectory = serverConfig.cwd;
        }

        // Preserve timeout
        if (serverConfig.timeout) {
          codexServer.timeout = serverConfig.timeout;
        }

        // Headers for HTTP/SSE transports
        if (serverConfig.headers) {
          codexServer.headers = serverConfig.headers;
        }

        return codexServer;
      },
      configWrapper: (servers: Record<string, McpServerMapping>) => ({
        // Configuration format for MCP wrapper servers that integrate with Codex CLI
        servers,
        _comment:
          "Configuration for MCP wrapper servers like openai-codex-mcp that integrate with Codex CLI",
        _usage:
          "Use with third-party MCP servers that expose Codex CLI functionality to other MCP clients",
        _examples: {
          python_server: "python -m mcp_server or uvicorn codex_server:app",
          nodejs_server: "node dist/server.js or npm start",
          docker_server: "docker run -i --rm custom/codex-mcp:latest",
        },
        _security_note: "Store API keys in environment variables, not in this configuration file",
        _supported_transports: ["stdio", "sse", "http"],
      }),
    },
    baseDir,
  );
}
