import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromFileParams, ToolMcpFromRulesyncMcpParams } from "./tool-mcp.js";

export class RooMcp extends ToolMcp {
  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolMcpFromFileParams): Promise<RooMcp> {
    const fileContent = await readFileContent(join(baseDir, ".roo/mcp.json"));
    return new RooMcp({
      baseDir: ".",
      relativeDirPath: ".roo",
      relativeFilePath: "mcp.json",
      fileContent,
      validate,
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
