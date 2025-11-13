import { join } from "node:path";
import { RULESYNC_IGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { readFileContent } from "../../utils/file.js";

export type RulesyncIgnoreSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncIgnore extends RulesyncFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static getSettablePaths(): RulesyncIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: RULESYNC_IGNORE_RELATIVE_FILE_PATH,
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
