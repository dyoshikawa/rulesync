import type { ToolTarget } from "../../types/index.js";
import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpConfig, BaseMcpServer } from "../../types/mcp-config.js";
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
const serverTransforms = {
  /**
   * Basic server transformation (command, args, env, url handling)
   */
  basic: (server: RulesyncMcpServer): McpServerMapping => {
    const result: McpServerMapping = {};

    if (server.command) {
      result.command = server.command;
      if (server.args) result.args = server.args;
    }

    if (server.url || server.httpUrl) {
      const url = server.httpUrl || server.url;
      if (url) result.url = url;
    }

    if (server.env) {
      result.env = server.env;
    }

    return result;
  },

  /**
   * Roo-specific server transformation (preserves httpUrl, transport, type, etc.)
   */
  roo: (server: RulesyncMcpServer): McpServerMapping => {
    const result = serverTransforms.extended(server);

    // Handle URL configuration specifically for Roo
    if (server.httpUrl) {
      if (!server.url) {
        // Only httpUrl provided - preserve as httpUrl
        result.httpUrl = server.httpUrl;
        delete result.url;
      }
      // If both httpUrl and url are provided, basic transform already handles precedence
      // by setting result.url to httpUrl value
    }

    if (server.transport) {
      result.transport = server.transport;
    }

    if (server.type) {
      result.type = server.type;
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

    // Additional fields for Gemini CLI and similar tools
    if (server.timeout !== undefined) {
      result.timeout = server.timeout;
    }

    if (server.trust !== undefined) {
      result.trust = server.trust;
    }

    if (server.headers) {
      result.headers = server.headers;
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

/**
 * MCP generator registry - Centralized configuration for supported tools
 * Note: Not all tools are in the registry - some have complex custom logic
 */
const MCP_GENERATOR_REGISTRY: Partial<Record<ToolTarget, McpToolConfig>> = {
  roo: {
    target: "roo",
    configPaths: [".roo/mcp.json"],
    serverTransform: serverTransforms.roo,
    configWrapper: configWrappers.mcpServers,
  },

  claudecode: {
    target: "claudecode",
    configPaths: [".mcp.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      const claudeServer: BaseMcpServer & { [key: string]: unknown } = {};

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
  },

  cursor: {
    target: "cursor",
    configPaths: [".cursor/mcp.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      const cursorServer: BaseMcpServer & {
        type?: "sse" | "streamable-http";
        [key: string]: unknown;
      } = {};

      if (server.command) {
        cursorServer.command = server.command;
        if (server.args) cursorServer.args = server.args;
      } else if (server.url || server.httpUrl) {
        const url = server.httpUrl || server.url;
        if (url) {
          cursorServer.url = url;
        }
        if (server.httpUrl || server.transport === "http") {
          cursorServer.type = "streamable-http";
        } else if (server.transport === "sse" || server.type === "sse") {
          cursorServer.type = "sse";
        }
      }

      if (server.env) {
        cursorServer.env = server.env;
      }

      if (server.cwd) {
        cursorServer.cwd = server.cwd;
      }

      return cursorServer;
    },
    configWrapper: configWrappers.mcpServers,
  },

  windsurf: {
    target: "windsurf",
    configPaths: ["mcp_config.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      const windsurfServer: BaseMcpServer & { serverUrl?: string; [key: string]: unknown } = {};

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
  },

  junie: {
    target: "junie",
    configPaths: [".junie/mcp/mcp.json"],
    serverTransform: (server: RulesyncMcpServer, serverName: string): McpServerMapping => {
      const junieServer: BaseMcpServer & {
        name?: string;
        workingDirectory?: string;
        transport?: "stdio" | "http" | "sse";
        [key: string]: unknown;
      } = {
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

      return junieServer;
    },
    configWrapper: configWrappers.mcpServers,
  },

  cline: {
    target: "cline",
    configPaths: [".cline/mcp.json"],
    serverTransform: serverTransforms.extended,
    configWrapper: configWrappers.mcpServers,
  },

  geminicli: {
    target: "geminicli",
    configPaths: [".gemini/settings.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      // Clone server config and remove targets (preserve all other properties)
      const { targets: _, ...serverConfig } = server;
      const geminiServer: McpServerMapping = { ...serverConfig };

      // Preserve environment variables as-is for Gemini CLI
      if (server.env) {
        geminiServer.env = server.env;
      }

      return geminiServer;
    },
    configWrapper: configWrappers.mcpServers,
  },

  opencode: {
    target: "opencode",
    configPaths: ["opencode.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      // Clone server config and remove targets (preserve all other properties)
      const { targets: _, ...serverConfig } = server;
      const opencodeServer: McpServerMapping = { ...serverConfig };

      // Preserve environment variables as-is for OpenCode
      if (server.env) {
        opencodeServer.env = server.env;
      }

      return opencodeServer;
    },
    configWrapper: configWrappers.mcpServers,
  },
};

/**
 * Generate MCP configuration using registry
 */
export function generateMcpFromRegistry(tool: ToolTarget, config: RulesyncMcpConfig): string {
  const generatorConfig = MCP_GENERATOR_REGISTRY[tool];
  if (!generatorConfig) {
    throw new Error(`No MCP generator configuration found for tool: ${tool}`);
  }
  return generateMcpConfig(config, generatorConfig);
}

/**
 * Create simple MCP generator functions for tools that use the registry pattern
 */
function createMcpGenerator(toolName: ToolTarget) {
  return {
    generateMcp: (config: RulesyncMcpConfig): string => {
      return generateMcpFromRegistry(toolName, config);
    },
    generateMcpConfiguration: (
      mcpServers: Record<string, RulesyncMcpServer>,
      baseDir: string = "",
    ): Array<{ filepath: string; content: string }> => {
      return generateMcpConfigurationFilesFromRegistry(toolName, mcpServers, baseDir);
    },
  };
}

// Pre-created MCP generators for common tools (only those actually used)
export const cursorMcpGenerator = createMcpGenerator("cursor");
export const clineMcpGenerator = createMcpGenerator("cline");

/**
 * Generate MCP configuration files using registry
 */
export function generateMcpConfigurationFilesFromRegistry(
  tool: ToolTarget,
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const generatorConfig = MCP_GENERATOR_REGISTRY[tool];
  if (!generatorConfig) {
    throw new Error(`No MCP generator configuration found for tool: ${tool}`);
  }

  // Special handling for tools with custom configuration structure
  if (tool === "junie") {
    return generateJunieMcpConfigurationFiles(mcpServers, baseDir);
  }

  // Tools with complex custom logic that are not in the registry
  const customTools = ["copilot", "augmentcode", "codexcli", "kiro"];
  if (customTools.includes(tool)) {
    throw new Error(
      `Tool ${tool} uses custom configuration logic - use its specific generator function instead`,
    );
  }

  return generateMcpConfigurationFiles(mcpServers, generatorConfig, baseDir);
}

/**
 * Special configuration files generation for Junie
 */
function generateJunieMcpConfigurationFiles(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const junieMcpPath = ".junie/mcp/mcp.json";
  // Generate project-level configuration only (as per precautions.md constraint)
  // Junie MCP config is stored in project root - no IDE settings path is used
  // to avoid creating user-level settings
  const filepath = baseDir ? `${baseDir}/${junieMcpPath}` : junieMcpPath;

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
    const junieServer: BaseMcpServer & {
      name?: string;
      workingDirectory?: string;
      transport?: "stdio" | "http" | "sse";
      [key: string]: unknown;
    } = {
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
