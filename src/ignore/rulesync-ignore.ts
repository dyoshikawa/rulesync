import { ValidationResult } from "../types/ai-file.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { readFileContent } from "../utils/file.js";

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
      relativeFilePath: ".rulesyncignore",
    };
  }

  static async fromFile(): Promise<RulesyncIgnore> {
    const fileContent = await readFileContent(this.getSettablePaths().relativeFilePath);

    return new RulesyncIgnore({
      baseDir: process.cwd(),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
    });
  }
}
