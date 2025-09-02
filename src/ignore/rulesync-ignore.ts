import { ValidationResult } from "../types/ai-file.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { readFileContent } from "../utils/file.js";

export class RulesyncIgnore extends RulesyncFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFile(): Promise<RulesyncIgnore> {
    const fileContent = await readFileContent(".rulesyncignore");

    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".rulesyncignore",
      fileContent,
    });
  }

  static async fromFilePath(_params: { filePath: string }): Promise<RulesyncIgnore> {
    throw new Error("Please use the fromFile method instead.");
  }
}
