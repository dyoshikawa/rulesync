import { readFile } from "node:fs/promises";
import { RULESYNC_MCP_FILE } from "../constants/paths.js";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncFile } from "../types/rulesync-file.js";

export class RulesyncMcp extends RulesyncFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncMcp> {
    const fileContent = await readFile(filePath, "utf-8");

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: RULESYNC_MCP_FILE,
      body: fileContent,
      fileContent,
    });
  }

  getFrontmatter(): Record<string, unknown> {
    return {};
  }
}
