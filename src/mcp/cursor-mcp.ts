import { readFile } from "node:fs/promises";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams, ToolMcpParams } from "./tool-mcp.js";

export type CursorMcpParams = ToolMcpParams;

export class CursorMcp extends ToolMcp {
  static async fromFilePath({ filePath }: { filePath: string }): Promise<CursorMcp> {
    const fileContent = await readFile(filePath, "utf-8");

    return new CursorMcp({
      baseDir: ".",
      relativeDirPath: ".cursor",
      relativeFilePath: "mcp.json",
      fileContent,
      validate: true,
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
