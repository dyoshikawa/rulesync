import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { AiFileFromFileParams, AiFileParams, ValidationResult } from "../../types/ai-file.js";
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

export type ToolPermissionsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export type ToolPermissionsFromFileParams = Pick<AiFileFromFileParams, "baseDir" | "validate">;

export type ToolPermissionsForDeletionParams = {
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
};

export abstract class ToolPermissions extends ToolFile {
  static getSettablePaths(): ToolPermissionsSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static fromRulesyncPermissions(
    _params: ToolPermissionsFromRulesyncPermissionsParams,
  ): ToolPermissions | Promise<ToolPermissions> {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncPermissions(): RulesyncPermissions;

  protected toRulesyncPermissionsDefault({
    fileContent,
  }: {
    fileContent: string;
  }): RulesyncPermissions {
    return new RulesyncPermissions({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent,
    });
  }

  static async fromFile(_params: ToolPermissionsFromFileParams): Promise<ToolPermissions> {
    throw new Error("Please implement this method in the subclass.");
  }

  static forDeletion(_params: ToolPermissionsForDeletionParams): ToolPermissions {
    throw new Error("Please implement this method in the subclass.");
  }
}
