import { readFile } from "node:fs/promises";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams } from "./tool-mcp.js";

export class ClaudecodeMcp extends ToolMcp {
  static async fromFilePath({ filePath }: { filePath: string }): Promise<ClaudecodeMcp> {
    const fileContent = await readFile(filePath, "utf-8");

    return new ClaudecodeMcp({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): ClaudecodeMcp {
    return new ClaudecodeMcp({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
      fileContent: rulesyncMcp.getFileContent(),
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
