import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

export type ToolMcpParams = AiFileParams;

export type ToolMcpFromRulesyncMcpParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncMcp: RulesyncMcp;
  logger?: Logger;
};

export type ToolMcpFromFileParams = Pick<
  AiFileFromFileParams,
  "outputRoot" | "validate" | "global"
> & {
  logger?: Logger;
};

export type ToolMcpForDeletionParams = {
  outputRoot?: string;
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
      validate: true, // ToolMcp runs subclass validation below when requested
    });

    // Validate after setting patterns, if validation was requested
    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  /**
   * Files this tool's MCP config also lives in, beyond its own settable path.
   * Empty for every tool whose MCP config is one self-contained file; see
   * `KimiCodeMcp`, whose global timeout defaults belong to a shared
   * `config.toml`. Mirrors the same hook on `ToolHooks`.
   */
  static async getAuxiliaryFiles(_params: {
    outputRoot?: string;
    global?: boolean;
    rulesyncMcp: RulesyncMcp;
    logger?: Logger;
  }): Promise<ToolFile[]> {
    return [];
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
    outputRoot = this.outputRoot,
  }: {
    fileContent?: string;
    outputRoot?: string;
  } = {}): RulesyncMcp {
    const content = fileContent ?? this.fileContent;
    const { $schema: _, ...json } = JSON.parse(content);
    const withSchema = {
      $schema: RULESYNC_MCP_SCHEMA_URL,
      ...json,
    };
    return new RulesyncMcp({
      outputRoot,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_MCP_FILE_NAME,
      fileContent: JSON.stringify(withSchema, null, 2),
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
