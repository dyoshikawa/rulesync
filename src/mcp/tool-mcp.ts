import { readFile } from "node:fs/promises";
import { AiFile, AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";

/**
 * Abstract base class for MCP (Model Context Protocol) tool configurations.
 * Extends AiFile to provide common functionality for generating MCP configuration files
 * for various AI development tools.
 */
export abstract class ToolMcp extends AiFile {
  /**
   * Load an MCP configuration from a file path.
   * This method must be implemented by concrete subclasses.
   */
  static async fromFilePath(_params: AiFileFromFilePathParams): Promise<ToolMcp> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Get the filename for the MCP configuration file.
   * This method must be implemented by concrete subclasses.
   *
   * @returns The filename including extension (e.g., "mcp.json", ".cursor/mcp.json")
   */
  abstract getFileName(): string;

  /**
   * Generate the content for the MCP configuration file.
   * This method must be implemented by concrete subclasses.
   *
   * @returns Promise that resolves to the file content as a string
   */
  abstract generateContent(): Promise<string>;

  /**
   * Validate the MCP configuration.
   * Base implementation provides basic validation, can be overridden by subclasses.
   *
   * @returns ValidationResult indicating success or failure with error details
   */
  validate(): ValidationResult {
    try {
      // Basic validation - ensure required properties exist
      if (!this.relativeDirPath) {
        return {
          success: false,
          error: new Error("relativeDirPath is required for ToolMcp"),
        };
      }

      if (!this.relativeFilePath) {
        return {
          success: false,
          error: new Error("relativeFilePath is required for ToolMcp"),
        };
      }

      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Helper method to load and parse a JSON configuration file.
   * Public static method for use by subclasses and tests.
   *
   * @param filePath - Path to the JSON file to load
   * @returns Promise that resolves to the parsed JSON object
   * @throws Error if file cannot be read or parsed
   */
  static async loadJsonConfig(filePath: string): Promise<Record<string, unknown>> {
    try {
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to load JSON configuration from ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Helper method to serialize MCP configuration to JSON string.
   * Public method for use by concrete subclasses.
   *
   * @param config - Configuration object to serialize
   * @param indent - Number of spaces to use for indentation (default: 2)
   * @returns JSON string representation of the configuration
   */
  serializeToJson(config: Record<string, unknown>, indent: number = 2): string {
    return JSON.stringify(config, null, indent);
  }

  /**
   * Get the full file path where this MCP configuration should be written.
   * Uses the filename from the abstract getFileName() method.
   *
   * @returns The complete file path
   */
  getTargetFilePath(): string {
    const fileName = this.getFileName();

    // If filename contains directory separators, use it as-is relative to baseDir
    if (fileName.includes("/") || fileName.includes("\\")) {
      return fileName;
    }

    // Otherwise, use the standard path construction
    return super.getFilePath();
  }
}
