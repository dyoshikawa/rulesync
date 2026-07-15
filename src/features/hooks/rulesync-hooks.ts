import { join } from "node:path";

import {
  RULESYNC_HOOKS_JSONC_FILE_NAME,
  RULESYNC_HOOKS_JSONC_RELATIVE_FILE_PATH,
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
  jsonc: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export class RulesyncHooks extends RulesyncFile {
  private readonly json: HooksConfig;

  constructor(params: RulesyncHooksParams) {
    super({ ...params });

    // Sources may be authored as JSONC (`hooks.jsonc`); plain JSON is valid
    // JSONC, so both variants parse through the same strict parser.
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
      jsonc: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_HOOKS_JSONC_FILE_NAME,
      },
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
    // The .jsonc variant takes precedence when both files exist.
    const candidates = [
      paths.jsonc,
      { relativeDirPath: paths.relativeDirPath, relativeFilePath: paths.relativeFilePath },
    ];

    for (const candidate of candidates) {
      const filePath = join(outputRoot, candidate.relativeDirPath, candidate.relativeFilePath);
      if (!(await fileExists(filePath))) {
        continue;
      }
      const fileContent = await readFileContent(filePath);
      return new RulesyncHooks({
        outputRoot,
        relativeDirPath: candidate.relativeDirPath,
        relativeFilePath: candidate.relativeFilePath,
        fileContent,
        validate,
      });
    }

    throw new Error(
      `No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} or ${RULESYNC_HOOKS_JSONC_RELATIVE_FILE_PATH} found.`,
    );
  }

  getJson(): HooksConfig {
    return this.json;
  }
}
