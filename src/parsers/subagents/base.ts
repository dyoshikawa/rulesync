import type { ParsedSubagent } from "../../types/subagent.js";
import type { ToolTarget } from "../../types/tool-targets.js";

/**
 * Abstract base class for subagent parsers
 */
export abstract class BaseSubagentParser {
  /**
   * Get the tool name this parser is for
   */
  abstract getToolName(): ToolTarget;

  /**
   * Get the directory path relative to base directory where agents are stored
   */
  abstract getAgentsDirectory(): string;

  /**
   * Parse subagents from the given base directory
   */
  abstract parseSubagents(baseDir: string): Promise<ParsedSubagent[]>;

  /**
   * Optional: tool-specific validation for subagent data
   */
  validateSubagent?(subagent: ParsedSubagent): boolean;

  /**
   * Optional: tool-specific transformation for subagent data
   */
  transformSubagent?(subagent: ParsedSubagent): ParsedSubagent;
}
