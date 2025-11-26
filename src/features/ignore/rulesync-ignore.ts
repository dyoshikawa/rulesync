import { join } from "node:path";
import {
  RULESYNC_IGNORE_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { fileExistsSync, readFileContent } from "../../utils/file.js";

export type RulesyncIgnoreSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncIgnore extends RulesyncFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static getSettablePaths(): RulesyncIgnoreSettablePaths {
    // Ignore file location/name resolution
    // - Either ".rulesync/.aiignore" or ".rulesyncignore" may be used.
    // - If both exist, throw an error explaining they cannot co-exist.
    // - If neither exists yet, the default location used for creation is ".rulesync/.aiignore".

    const baseDir = process.cwd();
    const aiignoreRelativePath = join(RULESYNC_RELATIVE_DIR_PATH, ".aiignore");
    const aiignorePath = join(baseDir, aiignoreRelativePath);
    const legacyIgnorePath = join(baseDir, RULESYNC_IGNORE_RELATIVE_FILE_PATH);

    const hasAiignore = fileExistsSync(aiignorePath);
    const hasLegacy = fileExistsSync(legacyIgnorePath);

    if (hasAiignore && hasLegacy) {
      throw new Error(
        "Both .rulesync/.aiignore and .rulesyncignore exist. Please keep only one ignore file.",
      );
    }

    // Resolution rules:
    // 1) If .rulesync/.aiignore exists -> use it
    // 2) Else if .rulesyncignore exists -> use it
    // 3) Else (neither exists) -> default to .rulesync/.aiignore
    const relativeFilePath = hasAiignore
      ? aiignoreRelativePath
      : hasLegacy
        ? RULESYNC_IGNORE_RELATIVE_FILE_PATH
        : aiignoreRelativePath;

    return {
      relativeDirPath: ".",
      relativeFilePath,
    };
  }

  static async fromFile(): Promise<RulesyncIgnore> {
    const baseDir = process.cwd();
    const filePath = join(baseDir, this.getSettablePaths().relativeFilePath);
    const fileContent = await readFileContent(filePath);

    return new RulesyncIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
    });
  }
}
