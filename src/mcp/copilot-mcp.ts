import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams, ToolMcpParams } from "./tool-mcp.js";

export type CopilotMcpParams = ToolMcpParams;

export class CopilotMcp extends ToolMcp {
  static async fromFilePath({ filePath }: { filePath: string }): Promise<CopilotMcp> {
    const fileContent = await readFileContent(filePath);

    return new CopilotMcp({
      baseDir: ".",
      relativeDirPath: ".vscode",
      relativeFilePath: "mcp.json",
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): CopilotMcp {
    return new CopilotMcp({
      baseDir,
      relativeDirPath: ".vscode",
      relativeFilePath: "mcp.json",
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
