/**
 * Common test utilities for MCP generators
 */

import type { RulesyncMcpServer } from "../types/mcp.js";
import type { ToolTarget } from "../types/tool-targets.js";

/**
 * Create a basic MCP server configuration for testing
 */
export function createMockMcpServer(overrides: Partial<RulesyncMcpServer> = {}): RulesyncMcpServer {
  return {
    command: "test-server",
    args: ["--stdio"],
    env: { NODE_ENV: "test" },
    ...overrides,
  };
}

/**
 * Create MCP servers for target filtering tests
 */
export function createTargetFilteringMcpServers() {
  return {
    server1: {
      command: "server1",
      targets: ["cursor", "claudecode"] satisfies ToolTarget[],
    },
    server2: {
      command: "server2",
      targets: ["claudecode"] satisfies ToolTarget[],
    },
    server3: {
      command: "server3",
      targets: ["*"] satisfies ["*"],
    },
    server4: {
      command: "server4",
      // No targets means all tools
    },
  } as const;
}

/**
 * Parse and validate generated MCP configuration
 */
export function parseAndValidateMcpConfig(content: string) {
  const config = JSON.parse(content);
  if (!config.mcpServers) {
    throw new Error("Generated config missing mcpServers property");
  }
  return config;
}

/**
 * Assert that a configuration file result has the expected filepath and is valid JSON
 */
export function assertValidMcpConfigFile(
  result: Array<{ filepath: string; content: string }>,
  expectedFilepath: string,
  index: number = 0,
) {
  if (!result[index]) {
    throw new Error(`Expected result at index ${index} but array has length ${result.length}`);
  }

  if (result[index].filepath !== expectedFilepath) {
    throw new Error(`Expected filepath "${expectedFilepath}" but got "${result[index].filepath}"`);
  }

  // Validate that content is valid JSON
  try {
    JSON.parse(result[index].content);
  } catch (error) {
    throw new Error(`Generated content is not valid JSON: ${error}`);
  }

  return parseAndValidateMcpConfig(result[index].content);
}

/**
 * Count servers that should be included for a specific target
 */
export function countServersForTarget(
  servers: Record<string, RulesyncMcpServer>,
  target: ToolTarget,
): number {
  return Object.values(servers).filter((server) => {
    if (!server.targets) return true; // No targets means all tools

    // Check for wildcard
    if (Array.isArray(server.targets) && server.targets.length === 1 && server.targets[0] === "*") {
      return true;
    }

    // Check if target is in the array (for regular target arrays)
    if (Array.isArray(server.targets) && server.targets.every((t) => t !== "*")) {
      return server.targets.includes(target);
    }

    return false;
  }).length;
}

/**
 * Create test data for different transport types
 */
export const mockTransportConfigs = {
  stdio: {
    command: "node",
    args: ["server.js"],
    env: { API_KEY: "test-key" },
  },
  sse: {
    url: "http://localhost:3000",
    transport: "sse" as const,
  },
  http: {
    httpUrl: "http://localhost:4000/stream",
    transport: "http" as const,
  },
  httpWithHeaders: {
    httpUrl: "http://localhost:5000/api",
    headers: { Authorization: "Bearer token" },
  },
} as const;

/**
 * Helper to create comprehensive test MCP configuration
 */
export function createComprehensiveMcpConfig() {
  return {
    mcpServers: {
      "stdio-server": mockTransportConfigs.stdio,
      "sse-server": mockTransportConfigs.sse,
      "http-server": mockTransportConfigs.http,
      "custom-headers": mockTransportConfigs.httpWithHeaders,
    },
  };
}
