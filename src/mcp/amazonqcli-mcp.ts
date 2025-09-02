import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams } from "./tool-mcp.js";

export class AmazonqcliMcp extends ToolMcp {
  static async fromFilePath({ filePath }: { filePath: string }): Promise<AmazonqcliMcp> {
    const fileContent = await readFileContent(filePath);

    return new AmazonqcliMcp({
      baseDir: ".",
      relativeDirPath: ".amazonq",
      relativeFilePath: ".mcp.json",
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): AmazonqcliMcp {
    return new AmazonqcliMcp({
      baseDir,
      relativeDirPath: ".amazonq",
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
