import {
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

export type ToolHooksParams = AiFileParams;

export type ToolHooksFromRulesyncHooksParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncHooks: RulesyncHooks;
  /**
   * Adapters warn through this about what a conversion cannot represent. The
   * processor passes its own logger, so a warning an adapter emits reaches the
   * user rather than only the tests that construct one.
   */
  logger?: Logger;
};

export type ToolHooksFromFileParams = Pick<
  AiFileFromFileParams,
  "outputRoot" | "validate" | "global"
>;

export type ToolHooksForDeletionParams = {
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

export type ToolHooksSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export abstract class ToolHooks extends ToolFile {
  constructor(params: ToolHooksParams) {
    super({
      ...params,
      validate: true,
    });

    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolHooksSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncHooks(options?: { logger?: Logger }): RulesyncHooks;

  protected toRulesyncHooksDefault({
    fileContent = undefined,
    outputRoot = this.outputRoot,
  }: {
    fileContent?: string;
    outputRoot?: string;
  } = {}): RulesyncHooks {
    return new RulesyncHooks({
      outputRoot,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_HOOKS_FILE_NAME,
      fileContent: fileContent ?? this.fileContent,
    });
  }

  static async fromFile(_params: ToolHooksFromFileParams): Promise<ToolHooks> {
    throw new Error("Please implement this method in the subclass.");
  }

  static forDeletion(_params: ToolHooksForDeletionParams): ToolHooks {
    throw new Error("Please implement this method in the subclass.");
  }

  static async getAuxiliaryFiles(_params: {
    outputRoot?: string;
    global?: boolean;
  }): Promise<ToolFile[]> {
    return [];
  }
}
