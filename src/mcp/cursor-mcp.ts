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

export type CursorMcpParams = ToolMcpParams;

export class CursorMcp extends ToolMcp {
  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolMcpFromFileParams): Promise<CursorMcp> {
    const fileContent = await readFileContent(join(baseDir, ".cursor/mcp.json"));

    return new CursorMcp({
      baseDir: ".",
      relativeDirPath: ".cursor",
      relativeFilePath: "mcp.json",
      fileContent,
      validate,
    });
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): CursorMcp {
    const json = rulesyncMcp.getJson();

    // Convert Rulesync MCP format to Cursor MCP format
    const cursorConfig = {
      mcpServers: json.mcpServers || {},
    };

    const fileContent = JSON.stringify(cursorConfig, null, 2);

    return new CursorMcp({
      baseDir,
      relativeDirPath: ".cursor",
      relativeFilePath: "mcp.json",
      fileContent,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: "rulesync.mcp.json",
      fileContent: this.fileContent,
      validate: true,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
