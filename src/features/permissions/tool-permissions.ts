import type { AiFileFromFileParams, AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

export type ToolPermissionsFromRulesyncPermissionsParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncPermissions: RulesyncPermissions;
  logger?: Logger;
  global?: boolean;
};

export type ToolPermissionsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export type ToolPermissionsFromFileParams = Pick<
  AiFileFromFileParams,
  "outputRoot" | "validate"
> & {
  global?: boolean;
  /**
   * Lets an adapter report what it read, e.g. that a value came out of a
   * machine-local overrides file the import is about to make committable.
   */
  logger?: Logger;
};

export type ToolPermissionsForDeletionParams = {
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

export abstract class ToolPermissions extends ToolFile {
  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  /**
   * Permission settings live in a tool's shared settings/config file, which
   * also carries settings rulesync does not own (other features' keys, user
   * preferences), so the permissions feature never deletes it outright;
   * retracting rules happens through an in-place merge instead. Subclasses
   * that override this only restate the reason for their own file.
   */
  override isDeletable(): boolean {
    return false;
  }

  static fromRulesyncPermissions(
    _params: ToolPermissionsFromRulesyncPermissionsParams,
  ): ToolPermissions | Promise<ToolPermissions> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * `logger` lets a translator report source content it cannot import; most
   * translators do not need it.
   */
  abstract toRulesyncPermissions(params?: { logger?: Logger }): RulesyncPermissions;

  protected toRulesyncPermissionsDefault({
    fileContent,
  }: {
    fileContent: string;
  }): RulesyncPermissions {
    return RulesyncPermissions.fromImportedFileContent({
      outputRoot: this.outputRoot,
      fileContent,
      sourcePath: this.getRelativePathFromCwd(),
    });
  }

  static async fromFile(_params: ToolPermissionsFromFileParams): Promise<ToolPermissions> {
    throw new Error("Please implement this method in the subclass.");
  }

  static forDeletion(_params: ToolPermissionsForDeletionParams): ToolPermissions {
    throw new Error("Please implement this method in the subclass.");
  }
}
