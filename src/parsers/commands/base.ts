import type { ParsedRule } from "../../types/index.js";
import type { ToolTarget } from "../../types/tool-targets.js";

/**
 * Abstract base class for command parsers
 */
export abstract class BaseCommandParser {
  /**
   * Get the tool name this parser is for
   */
  abstract getToolName(): ToolTarget;

  /**
   * Get the directory path relative to base directory where commands are stored
   */
  abstract getCommandsDirectory(): string;

  /**
   * Parse commands from the given base directory
   * Returns ParsedRule objects with type="command" to maintain compatibility
   */
  abstract parseCommands(baseDir: string): Promise<ParsedRule[]>;

  /**
   * Optional: tool-specific validation for command data
   */
  validateCommand?(command: ParsedRule): boolean;

  /**
   * Optional: tool-specific transformation for command data
   */
  transformCommand?(command: ParsedRule): ParsedRule;
}
