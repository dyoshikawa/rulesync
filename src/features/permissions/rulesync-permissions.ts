import { join } from "node:path";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { type PermissionsConfig, RulesyncPermissionsFileSchema } from "../../types/permissions.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { fileExists, readFileContent } from "../../utils/file.js";

export type RulesyncPermissionsParams = RulesyncFileParams;

export type RulesyncPermissionsFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "validate"
>;

export type RulesyncPermissionsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncPermissions extends RulesyncFile {
  private readonly json: PermissionsConfig;

  constructor(params: RulesyncPermissionsParams) {
    super({ ...params });

    this.json = JSON.parse(this.fileContent);
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncPermissionsSettablePaths {
    return {
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
    };
  }

  validate(): ValidationResult {
    const result = RulesyncPermissionsFileSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: RulesyncPermissionsFromFileParams): Promise<RulesyncPermissions> {
    const paths = RulesyncPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    if (!(await fileExists(filePath))) {
      throw new Error(`No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} found.`);
    }

    const fileContent = await readFileContent(filePath);
    return new RulesyncPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  getJson(): PermissionsConfig {
    return this.json;
  }
}
