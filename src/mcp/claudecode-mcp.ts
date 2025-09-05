import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromFileParams, ToolMcpFromRulesyncMcpParams } from "./tool-mcp.js";

export class ClaudecodeMcp extends ToolMcp {
  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolMcpFromFileParams): Promise<ClaudecodeMcp> {
    const fileContent = await readFileContent(join(baseDir, ".mcp.json"));

    return new ClaudecodeMcp({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
      fileContent,
      validate,
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
