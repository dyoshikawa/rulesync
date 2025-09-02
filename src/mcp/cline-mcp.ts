import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams, ToolMcpParams } from "./tool-mcp.js";

export type ClineMcpParams = ToolMcpParams;

export class ClineMcp extends ToolMcp {
  static async fromFilePath({ filePath }: { filePath: string }): Promise<ClineMcp> {
    const fileContent = await readFileContent(filePath);

    return new ClineMcp({
      baseDir: ".",
      relativeDirPath: ".cline",
      relativeFilePath: "mcp.json",
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): ClineMcp {
    return new ClineMcp({
      baseDir,
      relativeDirPath: ".cline",
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
