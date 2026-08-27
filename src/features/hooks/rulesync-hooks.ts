import { join } from "node:path";

import {
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_HOOKS_LEGACY_FILE_NAME,
  RULESYNC_HOOKS_LEGACY_RELATIVE_FILE_PATH,
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { type HooksConfig, HooksConfigSchema } from "../../types/hooks.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { fileExistsStrict, readFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import {
  RulesyncSourceNotFoundError,
  getRulesyncSourceCandidates,
  type RulesyncSourceSettablePaths,
} from "../../utils/rulesync-source-path.js";

export type RulesyncHooksParams = RulesyncFileParams;

export type RulesyncHooksFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "validate" | "relativeDirPath"
>;

export type RulesyncHooksSettablePaths = RulesyncSourceSettablePaths;

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
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_HOOKS_FILE_NAME,
      },
      legacy: [
        {
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_HOOKS_LEGACY_FILE_NAME,
        },
      ],
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
    relativeDirPath,
    validate = true,
  }: RulesyncHooksFromFileParams): Promise<RulesyncHooks> {
    const paths = RulesyncHooks.getSettablePaths();
    // `relativeDirPath` overrides the class-level default (`.rulesync/`) for
    // both recommended and legacy candidates so a caller loading from
    // e.g. `.rulesync.local/` finds files in that tree instead. See the
    // `inputRoots` design note.
    const overrideDirPath = relativeDirPath;

    // The .jsonc variant takes precedence when both files exist.
    for (const candidate of getRulesyncSourceCandidates({ paths })) {
      const candidateDirPath = overrideDirPath ?? candidate.relativeDirPath;
      const filePath = join(outputRoot, candidateDirPath, candidate.relativeFilePath);

      if (!(await fileExistsStrict(filePath))) {
        continue;
      }

      const fileContent = await readFileContent(filePath);

      return new RulesyncHooks({
        outputRoot,
        relativeDirPath: candidateDirPath,
        relativeFilePath: candidate.relativeFilePath,
        fileContent,
        validate,
      });
    }

    throw new RulesyncSourceNotFoundError(
      `No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} or ${RULESYNC_HOOKS_LEGACY_RELATIVE_FILE_PATH} found.`,
    );
  }

  getJson(): HooksConfig {
    return this.json;
  }
}
