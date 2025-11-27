import { join } from "node:path";
import {
  RULESYNC_AIIGNORE_FILE_NAME,
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_IGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { fileExists, fileExistsSync, readFileContent } from "../../utils/file.js";

export type RulesyncIgnoreSettablePaths = {
  recommended: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  legacy: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export class RulesyncIgnore extends RulesyncFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static getSettablePaths(): RulesyncIgnoreSettablePaths {
    // Ignore file location/name resolution
    // - Either ".rulesync/.aiignore" (recommended) or ".rulesyncignore" (legacy) may be used.
    // - If both exist, throw an error explaining they cannot co-exist.
    const baseDir = process.cwd();
    const aiignorePath = join(baseDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
    const legacyIgnorePath = join(baseDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);

    const hasAiignore = fileExistsSync(aiignorePath);
    const hasLegacy = fileExistsSync(legacyIgnorePath);

    if (hasAiignore && hasLegacy) {
      throw new Error(
        "Both .rulesync/.aiignore and .rulesyncignore exist. Please keep only one ignore file.",
      );
    }

    return {
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
      },
      legacy: {
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_IGNORE_RELATIVE_FILE_PATH,
      },
    };
  }

  static async fromFile(): Promise<RulesyncIgnore> {
    const baseDir = process.cwd();
    const paths = this.getSettablePaths();
    const recommendedPath = join(
      baseDir,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    );
    const legacyPath = join(baseDir, paths.legacy.relativeDirPath, paths.legacy.relativeFilePath);

    if (await fileExists(recommendedPath)) {
      const fileContent = await readFileContent(recommendedPath);
      return new RulesyncIgnore({
        baseDir,
        relativeDirPath: paths.recommended.relativeDirPath,
        relativeFilePath: paths.recommended.relativeFilePath,
        fileContent,
      });
    }

    if (await fileExists(legacyPath)) {
      const fileContent = await readFileContent(legacyPath);
      return new RulesyncIgnore({
        baseDir,
        relativeDirPath: paths.legacy.relativeDirPath,
        relativeFilePath: paths.legacy.relativeFilePath,
        fileContent,
      });
    }

    // If neither exists, try to read recommended path (will throw appropriate error)
    const fileContent = await readFileContent(recommendedPath);
    return new RulesyncIgnore({
      baseDir,
      relativeDirPath: paths.recommended.relativeDirPath,
      relativeFilePath: paths.recommended.relativeFilePath,
      fileContent,
    });
  }
}
