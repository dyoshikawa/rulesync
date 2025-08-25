import type { ParsedSubagent } from "../../types/subagent.js";
import { ClaudeCodeSubagentParser } from "./claudecode.js";

// Export base class
export { BaseSubagentParser } from "./base.js";
// Export specific parsers
export { ClaudeCodeSubagentParser } from "./claudecode.js";
// Export shared utilities
export { parseSubagentFile, parseSubagentsFromDirectory } from "./shared.js";

/**
 * Interface for subagent parsers
 */
export interface SubagentParser {
  parseSubagents(baseDir: string): Promise<ParsedSubagent[]>;
  getAgentsDirectory(): string;
}

/**
 * Registry of subagent parsers
 */
const subagentParsers: Record<string, SubagentParser> = {
  claudecode: new ClaudeCodeSubagentParser(),
};

/**
 * Get a subagent parser for the given tool
 */
export function getSubagentParser(tool: string): SubagentParser | undefined {
  return subagentParsers[tool];
}

/**
 * Get all available subagent parser tool names
 */
export function getAvailableSubagentParserTools(): string[] {
  return Object.keys(subagentParsers);
}
