import { join } from "node:path";

import {
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { type HooksConfig, HooksConfigSchema } from "../../types/hooks.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { fileExists, readFileContent } from "../../utils/file.js";

export type RulesyncHooksParams = RulesyncFileParams;

export type RulesyncHooksFromFileParams = Pick<RulesyncFileFromFileParams, "baseDir" | "validate">;

export type RulesyncHooksSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncHooks extends RulesyncFile {
  private readonly json: HooksConfig;

  constructor(params: RulesyncHooksParams) {
    super({ ...params });

    this.json = JSON.parse(this.fileContent);
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncHooksSettablePaths {
    return {
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
    };
  }

  validate(): ValidationResult {
    const result = HooksConfigSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: RulesyncHooksFromFileParams): Promise<RulesyncHooks> {
    const paths = RulesyncHooks.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);

    if (!(await fileExists(filePath))) {
      throw new Error(`No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} found.`);
    }

    const fileContent = await readFileContent(filePath);
    return new RulesyncHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  getJson(): HooksConfig {
    return this.json;
  }
}
