/**
 * Common types for MCP operations (generate, import)
 */

import { type WarningCollectingLogger } from "../utils/logger.js";

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
  permissionsCount: number;
  checksCount: number;
  activationCount?: number;
  totalCount: number;
};

/**
 * The diagnostics an operation raised, as the caller receives them.
 *
 * The MCP server writes nothing to a console the caller can see, so anything
 * worth acting on has to travel in the result itself. Present on failures too,
 * since a run that warned and then failed is exactly when the warnings matter.
 * Omitted when there is nothing to report, so the key's presence means "read
 * this" rather than "the field exists".
 */
export type McpWarnings = {
  warnings?: string[];
};

/** Spreads into a result, contributing the key only when there is something in it. */
export function warningsField(logger: WarningCollectingLogger): McpWarnings {
  const warnings = logger.getWarnings();
  return warnings.length > 0 ? { warnings } : {};
}
