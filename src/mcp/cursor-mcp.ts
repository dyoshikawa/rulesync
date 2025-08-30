import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CURSOR_MCP_FILE } from "../constants/paths.js";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams, ToolMcpParams } from "./tool-mcp.js";

export type CursorMcpParams = ToolMcpParams;

export class CursorMcp extends ToolMcp {
  

  static async fromFilePath({ filePath }: { filePath: string }): Promise<CursorMcp> {
    const fileContent = await readFile(filePath, "utf-8");
    let json: Record<string, unknown>;

    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Invalid JSON in Cursor MCP file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return new CursorMcp({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: CURSOR_MCP_FILE,
      fileContent,
      json,
      validate: false,
    });
  }

  static fromRulesyncMcp({
    baseDir = ".",
    relativeDirPath,
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
      relativeDirPath,
      relativeFilePath: CURSOR_MCP_FILE,
      fileContent,
      json: cursorConfig,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const rulesyncConfig = {
      mcpServers: this.json.mcpServers || {},
    };

    const fileContent = JSON.stringify(rulesyncConfig, null, 2);

    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: "rulesync.mcp.json",
      body: fileContent,
      fileContent,
      json: rulesyncConfig,
      validate: false,
    });
  }

  validate(): ValidationResult {
    try {
      if (!this.json || typeof this.json !== "object") {
        return {
          success: false,
          error: new Error("Invalid MCP configuration: must be a JSON object"),
        };
      }

      const mcpServers = this.json.mcpServers;
      if (mcpServers && typeof mcpServers !== "object") {
        return {
          success: false,
          error: new Error("Invalid MCP configuration: mcpServers must be an object"),
        };
      }

      // Validate each server configuration
      if (mcpServers) {
        for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
          if (!serverConfig || typeof serverConfig !== "object") {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": must be an object`,
              ),
            };
          }

          // eslint-disable-next-line no-type-assertion/no-type-assertion
          const config = serverConfig as Record<string, unknown>;

          // Check for required fields
          const hasCommand = typeof config.command === "string";
          const hasUrl = typeof config.url === "string";

          if (!hasCommand && !hasUrl) {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": must have either "command" or "url"`,
              ),
            };
          }

          // Validate optional fields
          if (config.args && !Array.isArray(config.args)) {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "args" must be an array`,
              ),
            };
          }

          if (config.env && typeof config.env !== "object") {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "env" must be an object`,
              ),
            };
          }

          if (config.type && typeof config.type !== "string") {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "type" must be a string`,
              ),
            };
          }

          if (config.cwd && typeof config.cwd !== "string") {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "cwd" must be a string`,
              ),
            };
          }
        }
      }

      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  getTargetFilePath(): string {
    return join(this.baseDir, this.relativeDirPath, CURSOR_MCP_FILE);
  }
}
