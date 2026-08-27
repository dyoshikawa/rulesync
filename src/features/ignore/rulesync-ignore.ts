import { join } from "node:path";

import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_IGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { RulesyncFile, RulesyncFileFromFileParams } from "../../types/rulesync-file.js";
import { fileExistsStrict, readFileContent } from "../../utils/file.js";
import { RulesyncSourceNotFoundError } from "../../utils/rulesync-source-path.js";
import type {
  RulesyncSourcePath,
  RulesyncSourceSettablePaths,
} from "../../utils/rulesync-source-path.js";

export type RulesyncIgnoreFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "relativeDirPath"
>;

export type RulesyncIgnoreSettablePaths = Omit<RulesyncSourceSettablePaths, "legacy"> & {
  legacy: readonly [RulesyncSourcePath];
};

export class RulesyncIgnore extends RulesyncFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static getSettablePaths(): RulesyncIgnoreSettablePaths {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
      },
      legacy: [
        {
          relativeDirPath: ".",
          relativeFilePath: RULESYNC_IGNORE_RELATIVE_FILE_PATH,
        },
      ],
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
  }: RulesyncIgnoreFromFileParams = {}): Promise<RulesyncIgnore> {
    const paths = this.getSettablePaths();
    // `relativeDirPath` overrides the class-level default when the caller
    // (a processor loading from a non-default source tree such as
    // `.rulesync.local`) needs to point at a tree whose basename differs
    // from `.rulesync`. The legacy `.rulesyncignore` path stays anchored
    // at `outputRoot` because it's a project-level file, not a per-tree
    // one. See the `inputRoots` design note.
    const recommendedDirPath = relativeDirPath ?? paths.recommended.relativeDirPath;
    const recommendedPath = join(
      outputRoot,
      recommendedDirPath,
      paths.recommended.relativeFilePath,
    );
    const [legacy] = paths.legacy;
    const legacyPath = join(outputRoot, legacy.relativeDirPath, legacy.relativeFilePath);

    if (await fileExistsStrict(recommendedPath)) {
      const fileContent = await readFileContent(recommendedPath);
      return new RulesyncIgnore({
        outputRoot,
        relativeDirPath: recommendedDirPath,
        relativeFilePath: paths.recommended.relativeFilePath,
        fileContent,
      });
    }

    if (await fileExistsStrict(legacyPath)) {
      const fileContent = await readFileContent(legacyPath);
      return new RulesyncIgnore({
        outputRoot,
        relativeDirPath: legacy.relativeDirPath,
        relativeFilePath: legacy.relativeFilePath,
        fileContent,
      });
    }

    throw new RulesyncSourceNotFoundError(
      `No ${join(recommendedDirPath, paths.recommended.relativeFilePath)} or ${join(legacy.relativeDirPath, legacy.relativeFilePath)} found.`,
    );
  }
}
