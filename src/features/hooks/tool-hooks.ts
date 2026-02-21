import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

export type ToolHooksParams = AiFileParams;

export type ToolHooksFromRulesyncHooksParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncHooks: RulesyncHooks;
};

export type ToolHooksFromFileParams = Pick<AiFileFromFileParams, "baseDir" | "validate" | "global">;

export type ToolHooksForDeletionParams = {
  baseDir?: string;
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

  abstract toRulesyncHooks(): RulesyncHooks;

  protected toRulesyncHooksDefault({
    fileContent = undefined,
  }: {
    fileContent?: string;
  } = {}): RulesyncHooks {
    return new RulesyncHooks({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: fileContent ?? this.fileContent,
    });
  }

  static async fromFile(_params: ToolHooksFromFileParams): Promise<ToolHooks> {
    throw new Error("Please implement this method in the subclass.");
  }

  static forDeletion(_params: ToolHooksForDeletionParams): ToolHooks {
    throw new Error("Please implement this method in the subclass.");
  }
}
