import { readFile } from "node:fs/promises";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams } from "./tool-mcp.js";

export class RooMcp extends ToolMcp {
  static async fromFilePath({ filePath }: { filePath: string }): Promise<RooMcp> {
    const fileContent = await readFile(filePath, "utf-8");
    return new RooMcp({
      baseDir: ".",
      relativeDirPath: ".roo",
      relativeFilePath: "mcp.json",
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): RooMcp {
    const fileContent = rulesyncMcp.getFileContent();

    return new RooMcp({
      baseDir,
      relativeDirPath: ".roo",
      relativeFilePath: "mcp.json",
      fileContent,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
