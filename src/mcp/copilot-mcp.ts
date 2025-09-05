import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
} from "./tool-mcp.js";

export type CopilotMcpParams = ToolMcpParams;

export class CopilotMcp extends ToolMcp {
  static async fromFilePath({
    baseDir = ".",
    validate = true,
  }: ToolMcpFromFileParams): Promise<CopilotMcp> {
    const fileContent = await readFileContent(join(baseDir, ".vscode/mcp.json"));

    return new CopilotMcp({
      baseDir: ".",
      relativeDirPath: ".vscode",
      relativeFilePath: "mcp.json",
      fileContent,
      validate,
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
