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

export type ClineMcpParams = ToolMcpParams;

export class ClineMcp extends ToolMcp {
  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolMcpFromFileParams): Promise<ClineMcp> {
    const fileContent = await readFileContent(join(baseDir, ".cline/mcp.json"));

    return new ClineMcp({
      baseDir: ".",
      relativeDirPath: ".cline",
      relativeFilePath: "mcp.json",
      fileContent,
      validate,
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
