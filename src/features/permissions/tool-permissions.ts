import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

export type ToolPermissionsParams = AiFileParams;

export type ToolPermissionsFromRulesyncPermissionsParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncPermissions: RulesyncPermissions;
  logger?: Logger;
};

export type ToolPermissionsFromFileParams = Pick<
  AiFileFromFileParams,
  "baseDir" | "validate" | "global"
>;

export type ToolPermissionsForDeletionParams = {
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

export type ToolPermissionsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export abstract class ToolPermissions extends ToolFile {
  constructor(params: ToolPermissionsParams) {
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

  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncPermissions(): RulesyncPermissions;

  protected toRulesyncPermissionsDefault({
    fileContent = undefined,
  }: {
    fileContent?: string;
  } = {}): RulesyncPermissions {
    return new RulesyncPermissions({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "permissions.json",
      fileContent: fileContent ?? this.fileContent,
    });
  }

  static async fromFile(_params: ToolPermissionsFromFileParams): Promise<ToolPermissions> {
    throw new Error("Please implement this method in the subclass.");
  }

  static forDeletion(_params: ToolPermissionsForDeletionParams): ToolPermissions {
    throw new Error("Please implement this method in the subclass.");
  }
}
