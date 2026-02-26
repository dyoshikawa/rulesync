import { AiFile, AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import type { RulesyncCommand } from "./rulesync-command.js";

export type ToolCommandFromRulesyncCommandParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncCommand: RulesyncCommand;
};

export type ToolCommandFromFileParams = AiFileFromFileParams;

export type ToolCommandSettablePaths = {
  relativeDirPath: string;
};

export type ToolCommandForDeletionParams = {
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

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
  static getSettablePaths(): ToolCommandSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

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
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   *
   * @param params - Parameters including the file path
   * @returns A concrete ToolCommand instance with minimal data for deletion
   */
  static forDeletion(_params: ToolCommandForDeletionParams): ToolCommand {
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

  /**
   * Check if this tool is targeted by a RulesyncCommand based on its targets field.
   * Subclasses should override this to provide specific targeting logic.
   *
   * @param rulesyncCommand - The RulesyncCommand to check
   * @returns True if this tool is targeted by the command
   */
  static isTargetedByRulesyncCommand(_rulesyncCommand: RulesyncCommand): boolean {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Default implementation for checking if a tool is targeted by a RulesyncCommand.
   * Checks if the command's targets include the tool target or a wildcard.
   *
   * @param params - Parameters including the RulesyncCommand and tool target
   * @returns True if the tool target is included in the command's targets
   */
  protected static isTargetedByRulesyncCommandDefault({
    rulesyncCommand,
    toolTarget,
  }: {
    rulesyncCommand: RulesyncCommand;
    toolTarget: ToolTarget;
  }): boolean {
    const targets = rulesyncCommand.getFrontmatter().targets;
    if (!targets) {
      return true;
    }

    if (targets.includes("*")) {
      return true;
    }

    if (targets.includes(toolTarget)) {
      return true;
    }

    return false;
  }
}
