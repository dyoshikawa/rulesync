/**
 * Common types for MCP operations (generate, import)
 */

/**
 * Common result counts for file operations
 * Used by both generate and import operations
 */
export type McpResultCounts = {
  rulesCount: number;
  ignoreCount: number;
  mcpCount: number;
  commandsCount: number;
  subagentsCount: number;
  skillsCount: number;
  hooksCount: number;
  totalCount: number;
};
