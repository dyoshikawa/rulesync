import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

export type ToolMcpParams = AiFileParams;

export type ToolMcpFromRulesyncMcpParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncMcp: RulesyncMcp;
};

export type ToolMcpFromFileParams = Pick<AiFileFromFileParams, "baseDir" | "validate" | "global">;

export type ToolMcpForDeletionParams = {
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

export type ToolMcpSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export abstract class ToolMcp extends ToolFile {
  constructor({ ...rest }: ToolMcpParams) {
    super({
      ...rest,
      validate: true, // Skip validation during construction
    });

    // Validate after setting patterns, if validation was requested
    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  static getToolTargetsGlobal(): ToolMcpSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Convert this tool MCP configuration to a RulesyncMcp for import.
   * @param outputBaseDir - Base directory for the output rulesync file.
   *   In global mode, this should be process.cwd() (the rulesync project directory),
   *   not the home directory where tool files are located.
   *   Defaults to process.cwd().
   */
  abstract toRulesyncMcp(options?: { outputBaseDir?: string }): RulesyncMcp;

  /**
   * Default implementation for toRulesyncMcp.
   * @param outputBaseDir - Base directory for the output rulesync file.
   *   Defaults to process.cwd() to support global mode where tool files
   *   are in home directory but rulesync files should be in the project directory.
   * @param fileContent - Optional file content override.
   */
  protected toRulesyncMcpDefault({
    outputBaseDir = process.cwd(),
    fileContent = undefined,
  }: {
    outputBaseDir?: string;
    fileContent?: string;
  } = {}): RulesyncMcp {
    return new RulesyncMcp({
      baseDir: outputBaseDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: ".mcp.json",
      fileContent: fileContent ?? this.fileContent,
    });
  }

  static async fromFile(_params: ToolMcpFromFileParams): Promise<ToolMcp> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params: ToolMcpForDeletionParams): ToolMcp {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncMcp(_params: ToolMcpFromRulesyncMcpParams): ToolMcp | Promise<ToolMcp> {
    throw new Error("Please implement this method in the subclass.");
  }
}
