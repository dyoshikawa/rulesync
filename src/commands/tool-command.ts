import { AiFile, AiFileFromFileParams, AiFileParams } from "../types/ai-file.js";
import type { RulesyncCommand } from "./rulesync-command.js";

export type ToolCommandFromRulesyncCommandParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncCommand: RulesyncCommand;
};

export type ToolCommandFromFileParams = AiFileFromFileParams;

/**
 * Abstract base class for AI development tool-specific command formats.
 *
 * ToolCommand serves as an intermediary between RulesyncCommand (internal format)
 * and specific tool command formats (e.g., Claude Code, Roo Code, Gemini CLI).
 *
 * It provides a consistent interface for:
 * - Converting from RulesyncCommand to tool-specific format
 * - Converting from tool-specific format back to RulesyncCommand
 * - Loading commands directly from tool-specific files
 *
 * Concrete implementations should handle:
 * - Tool-specific frontmatter structure and validation
 * - Tool-specific file naming conventions
 * - Tool-specific body content formatting
 */
export abstract class ToolCommand extends AiFile {
  /**
   * Load a command from a tool-specific file path.
   *
   * This method should:
   * 1. Read the file content
   * 2. Parse tool-specific frontmatter format
   * 3. Validate the parsed data
   * 4. Return a concrete ToolCommand instance
   *
   * @param params - Parameters including the file path to load
   * @returns Promise resolving to a concrete ToolCommand instance
   */
  static async fromFile(_params: ToolCommandFromFileParams): Promise<ToolCommand> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Convert a RulesyncCommand to the tool-specific command format.
   *
   * This method should:
   * 1. Extract relevant data from the RulesyncCommand
   * 2. Transform frontmatter to tool-specific format
   * 3. Transform body content if needed
   * 4. Return a concrete ToolCommand instance
   *
   * @param params - Parameters including the RulesyncCommand to convert
   * @returns A concrete ToolCommand instance
   */
  static fromRulesyncCommand(_params: ToolCommandFromRulesyncCommandParams): ToolCommand {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Convert this tool-specific command back to a RulesyncCommand.
   *
   * This method should:
   * 1. Transform tool-specific frontmatter to RulesyncCommand format
   * 2. Transform body content if needed
   * 3. Return a RulesyncCommand instance
   *
   * @returns A RulesyncCommand instance
   */
  abstract toRulesyncCommand(): RulesyncCommand;
}
