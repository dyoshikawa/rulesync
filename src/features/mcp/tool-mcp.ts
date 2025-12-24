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

  abstract toRulesyncMcp(): RulesyncMcp;

  protected toRulesyncMcpDefault({
    fileContent = undefined,
  }: {
    fileContent?: string;
  } = {}): RulesyncMcp {
    return new RulesyncMcp({
      baseDir: this.baseDir,
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
