import type { ParsedRule } from "../../types/index.js";
import { ClaudeCodeCommandParser } from "./claudecode.js";
import { GeminiCommandParser } from "./geminicli.js";
import { QwenCodeCommandParser } from "./qwencode.js";

// Export base class
export { BaseCommandParser } from "./base.js";
// Export specific parsers
export { ClaudeCodeCommandParser } from "./claudecode.js";
export { GeminiCommandParser } from "./geminicli.js";
export { QwenCodeCommandParser } from "./qwencode.js";
// Export shared utilities
export { parseCommandFile, parseCommandsFromDirectory } from "./shared.js";

/**
 * Interface for command parsers
 */
export interface CommandParser {
  parseCommands(baseDir: string): Promise<ParsedRule[]>;
  getCommandsDirectory(): string;
}

/**
 * Registry of command parsers
 */
const commandParsers: Record<string, CommandParser> = {
  claudecode: new ClaudeCodeCommandParser(),
  geminicli: new GeminiCommandParser(),
  qwencode: new QwenCodeCommandParser(),
};

/**
 * Get a command parser for the given tool
 */
export function getCommandParser(tool: string): CommandParser | undefined {
  return commandParsers[tool];
}

/**
 * Get all available command parser tool names
 */
export function getAvailableCommandParserTools(): string[] {
  return Object.keys(commandParsers);
}
