import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDECODE_MCP_FILE } from "../constants/paths.js";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams, ToolMcpParams } from "./tool-mcp.js";

export type ClaudecodeMcpParams = ToolMcpParams;

export class ClaudecodeMcp extends ToolMcp {
  static getSupportedMcpFileNames(): string[] {
    return [CLAUDECODE_MCP_FILE];
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<ClaudecodeMcp> {
    const fileContent = await readFile(filePath, "utf-8");
    let json: Record<string, unknown>;

    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Invalid JSON in Claude Code MCP file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return new ClaudecodeMcp({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: CLAUDECODE_MCP_FILE,
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
  }: ToolMcpFromRulesyncMcpParams): ClaudecodeMcp {
    const json = rulesyncMcp.getJson();

    // Convert Rulesync MCP format to Claude Code MCP format
    const claudeCodeConfig = {
      mcpServers: json.mcpServers || {},
    };

    const fileContent = JSON.stringify(claudeCodeConfig, null, 2);

    return new ClaudecodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: CLAUDECODE_MCP_FILE,
      fileContent,
      json: claudeCodeConfig,
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

          // Check for required fields - Claude Code supports command, url, or httpUrl
          const hasCommand = typeof config.command === "string";
          const hasUrl = typeof config.url === "string";
          const hasHttpUrl = typeof config.httpUrl === "string";

          if (!hasCommand && !hasUrl && !hasHttpUrl) {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": must have "command", "url", or "httpUrl"`,
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

          if (config.transport && typeof config.transport !== "string") {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "transport" must be a string`,
              ),
            };
          }

          if (config.timeout && typeof config.timeout !== "number") {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "timeout" must be a number`,
              ),
            };
          }

          if (config.disabled && typeof config.disabled !== "boolean") {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "disabled" must be a boolean`,
              ),
            };
          }

          if (config.headers && typeof config.headers !== "object") {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "headers" must be an object`,
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
    return join(this.baseDir, this.relativeDirPath, CLAUDECODE_MCP_FILE);
  }
}
