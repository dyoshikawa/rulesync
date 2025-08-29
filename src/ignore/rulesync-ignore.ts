import { readFile } from "node:fs/promises";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncFile } from "../types/rulesync-file.js";

export class RulesyncIgnore extends RulesyncFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncIgnore> {
    const fileContent = await readFile(filePath, "utf-8");

    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".rulesyncignore",
      body: fileContent,
      fileContent,
    });
  }

  getFrontmatter(): Record<string, unknown> {
    return {};
  }
}
