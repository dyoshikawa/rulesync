import { join } from "node:path";

import {
  RULESYNC_HOOKS_JSONC_FILE_NAME,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { type HooksConfig, HooksConfigSchema } from "../../types/hooks.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";

export type RulesyncHooksParams = RulesyncFileParams;

export type RulesyncHooksFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "validate"
>;

export type RulesyncHooksSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncHooks extends RulesyncFile {
  private readonly json: HooksConfig;

  constructor(params: RulesyncHooksParams) {
    super({ ...params });

    // JSONC is a superset of JSON, so both `.json` and `.jsonc` sources parse here.
    this.json = parseJsonc(this.fileContent) as HooksConfig;
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
    outputRoot = process.cwd(),
    validate = true,
  }: RulesyncHooksFromFileParams): Promise<RulesyncHooks> {
    const paths = RulesyncHooks.getSettablePaths();

    // The `.jsonc` twin wins over `.json` when both exist.
    const jsoncFilePath = join(outputRoot, paths.relativeDirPath, RULESYNC_HOOKS_JSONC_FILE_NAME);
    if (await fileExists(jsoncFilePath)) {
      const fileContent = await readFileContent(jsoncFilePath);
      return new RulesyncHooks({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: RULESYNC_HOOKS_JSONC_FILE_NAME,
        fileContent,
        validate,
      });
    }

    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    if (!(await fileExists(filePath))) {
      throw new Error(`No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} found.`);
    }

    const fileContent = await readFileContent(filePath);
    return new RulesyncHooks({
      outputRoot,
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
