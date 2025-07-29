import type { ToolTarget } from "../../types/index.js";
import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

export interface McpServerMapping {
  [key: string]: unknown;
}

export interface McpToolConfig {
  /** Target tool identifier */
  target: ToolTarget;
  /** Configuration file paths relative to baseDir */
  configPaths: string[];
  /** Server property mappings and transformations */
  serverTransform: (server: RulesyncMcpServer, serverName: string) => McpServerMapping;
  /** Config object wrapper */
  configWrapper: (servers: Record<string, McpServerMapping>) => unknown;
}

/**
 * Generic MCP configuration generator factory
 */
export function generateMcpConfig(config: RulesyncMcpConfig, toolConfig: McpToolConfig): string {
  const servers: Record<string, McpServerMapping> = {};

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldIncludeServer(server, toolConfig.target)) continue;

    servers[serverName] = toolConfig.serverTransform(server, serverName);
  }

  const finalConfig = toolConfig.configWrapper(servers);
  return JSON.stringify(finalConfig, null, 2);
}

/**
 * Generic MCP configuration file generator
 */
export function generateMcpConfigurationFiles(
  mcpServers: Record<string, RulesyncMcpServer>,
  toolConfig: McpToolConfig,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const configs: Array<{ filepath: string; content: string }> = [];
  const rulesyncConfig: RulesyncMcpConfig = { mcpServers };

  for (const configPath of toolConfig.configPaths) {
    const filepath = baseDir ? `${baseDir}/${configPath}` : configPath;
    const content = generateMcpConfig(rulesyncConfig, toolConfig);
    configs.push({
      filepath,
      content: `${content}\n`,
    });
  }

  return configs;
}

/**
 * Common server transformation utilities
 */
export const serverTransforms = {
  /**
   * Basic server transformation (command, args, env, url handling)
   */
  basic: (server: RulesyncMcpServer): McpServerMapping => {
    const result: McpServerMapping = {};

    if (server.command) {
      result.command = server.command;
      if (server.args) result.args = server.args;
    } else if (server.url || server.httpUrl) {
      const url = server.httpUrl || server.url;
      if (url) result.url = url;
    }

    if (server.env) {
      result.env = server.env;
    }

    return result;
  },

  /**
   * Extended server transformation (includes disabled, alwaysAllow, etc.)
   */
  extended: (server: RulesyncMcpServer): McpServerMapping => {
    const result = serverTransforms.basic(server);

    if (server.disabled !== undefined) {
      result.disabled = server.disabled;
    }

    if (server.alwaysAllow) {
      result.alwaysAllow = server.alwaysAllow;
    }

    if (server.networkTimeout !== undefined) {
      result.networkTimeout = server.networkTimeout;
    }

    if (server.tools) {
      result.tools = server.tools;
    }

    return result;
  },

  /**
   * Remove rulesync-specific properties from server config
   */
  cleanRulesyncProps: (server: RulesyncMcpServer): McpServerMapping => {
    const { targets: _, transport: _transport, ...cleanServer } = server;
    return { ...cleanServer };
  },
};

/**
 * Common config wrappers
 */
export const configWrappers = {
  /**
   * Standard mcpServers wrapper
   */
  mcpServers: (servers: Record<string, McpServerMapping>) => ({
    mcpServers: servers,
  }),

  /**
   * Servers-only wrapper (for tools that use "servers" instead of "mcpServers")
   */
  servers: (servers: Record<string, McpServerMapping>) => ({
    servers,
  }),
};
