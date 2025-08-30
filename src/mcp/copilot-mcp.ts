import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { COPILOT_MCP_FILE } from "../constants/paths.js";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp, ToolMcpFromRulesyncMcpParams, ToolMcpParams } from "./tool-mcp.js";

export type CopilotMcpParams = ToolMcpParams;

export class CopilotMcp extends ToolMcp {
  static async fromFilePath({ filePath }: { filePath: string }): Promise<CopilotMcp> {
    const fileContent = await readFile(filePath, "utf-8");
    let json: Record<string, unknown>;

    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Invalid JSON in GitHub Copilot MCP file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return new CopilotMcp({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: COPILOT_MCP_FILE,
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
  }: ToolMcpFromRulesyncMcpParams): CopilotMcp {
    const json = rulesyncMcp.getJson();

    // Convert Rulesync MCP format to GitHub Copilot MCP format
    const copilotConfig = {
      servers: json.mcpServers || {},
    };

    const fileContent = JSON.stringify(copilotConfig, null, 2);

    return new CopilotMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: COPILOT_MCP_FILE,
      fileContent,
      json: copilotConfig,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const rulesyncConfig = {
      mcpServers: this.json.servers || {},
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

      // Validate inputs (optional)
      const inputs = this.json.inputs;
      if (inputs) {
        if (!Array.isArray(inputs)) {
          return {
            success: false,
            error: new Error("Invalid MCP configuration: inputs must be an array"),
          };
        }

        for (const [index, input] of inputs.entries()) {
          if (!input || typeof input !== "object") {
            return {
              success: false,
              error: new Error(`Invalid input at index ${index}: must be an object`),
            };
          }

          // eslint-disable-next-line no-type-assertion/no-type-assertion
          const inputConfig = input as Record<string, unknown>;

          if (typeof inputConfig.id !== "string") {
            return {
              success: false,
              error: new Error(`Invalid input at index ${index}: "id" must be a string`),
            };
          }

          if (inputConfig.type && typeof inputConfig.type !== "string") {
            return {
              success: false,
              error: new Error(`Invalid input at index ${index}: "type" must be a string`),
            };
          }

          if (inputConfig.description && typeof inputConfig.description !== "string") {
            return {
              success: false,
              error: new Error(`Invalid input at index ${index}: "description" must be a string`),
            };
          }

          if (inputConfig.password !== undefined && typeof inputConfig.password !== "boolean") {
            return {
              success: false,
              error: new Error(`Invalid input at index ${index}: "password" must be a boolean`),
            };
          }
        }
      }

      // Validate servers
      const servers = this.json.servers;
      if (servers && typeof servers !== "object") {
        return {
          success: false,
          error: new Error("Invalid MCP configuration: servers must be an object"),
        };
      }

      // Validate each server configuration
      if (servers) {
        for (const [serverName, serverConfig] of Object.entries(servers)) {
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

          // Check for required fields - Copilot supports command or url
          const hasCommand = typeof config.command === "string";
          const hasUrl = typeof config.url === "string";

          if (!hasCommand && !hasUrl) {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": must have "command" or "url"`,
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

          if (config.tools && !Array.isArray(config.tools)) {
            return {
              success: false,
              error: new Error(
                `Invalid server configuration for "${serverName}": "tools" must be an array`,
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
    return join(this.baseDir, this.relativeDirPath, COPILOT_MCP_FILE);
  }
}
