import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromFileParams, ToolMcpFromRulesyncMcpParams } from "./tool-mcp.js";

export class AmazonqcliMcp extends ToolMcp {
  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolMcpFromFileParams): Promise<AmazonqcliMcp> {
    const fileContent = await readFileContent(join(baseDir, ".amazonq/mcp.json"));

    return new AmazonqcliMcp({
      baseDir,
      relativeDirPath: ".amazonq",
      relativeFilePath: "mcp.json",
      fileContent,
      validate,
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
