import type { RulesyncMcpServer } from "../../types/mcp.js";
import type { ToolTarget } from "../../types/tool-targets.js";

/**
 * Result of parsing MCP server configurations
 */
export interface McpParseResult {
  mcpServers: Record<string, RulesyncMcpServer>;
  errors: string[];
}

/**
 * Abstract base class for MCP parsers
 */
export abstract class BaseMcpParser {
  /**
   * Get the tool name this parser is for
   */
  abstract getToolName(): ToolTarget;

  /**
   * Get the MCP configuration file name(s) this parser looks for
   */
  abstract getMcpConfigFileName(): string | string[];

  /**
   * Parse MCP server configurations from the given base directory
   */
  abstract parseMcp(baseDir: string): Promise<McpParseResult>;

  /**
   * Optional: tool-specific validation for MCP server config
   */
  validateMcpServer?(serverId: string, server: RulesyncMcpServer): boolean;

  /**
   * Optional: tool-specific transformation for MCP server config
   */
  transformMcpServer?(serverId: string, server: RulesyncMcpServer): RulesyncMcpServer;

  /**
   * Combine multiple MCP parse results
   */
  protected combineResults(...results: McpParseResult[]): McpParseResult {
    const combined: McpParseResult = {
      mcpServers: {},
      errors: [],
    };

    for (const result of results) {
      Object.assign(combined.mcpServers, result.mcpServers);
      combined.errors.push(...result.errors);
    }

    return combined;
  }
}