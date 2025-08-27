import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import type { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import type { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for Windsurf MCP server configuration
 * Windsurf supports STDIO and SSE transport types
 */
export const WindsurfMcpServerSchema = z.object({
  // STDIO transport fields
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),

  // SSE transport fields
  serverUrl: z.optional(z.string()),

  // Common optional fields
  env: z.optional(z.record(z.string(), z.string())),
});

/**
 * Schema for Windsurf MCP configuration
 * Windsurf uses `mcp_config.json` files with mcpServers object
 */
export const WindsurfMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), WindsurfMcpServerSchema),
});

export type WindsurfMcpServer = z.infer<typeof WindsurfMcpServerSchema>;
export type WindsurfMcpConfig = z.infer<typeof WindsurfMcpConfigSchema>;

export interface WindsurfMcpParams {
  config: WindsurfMcpConfig;
}

/**
 * MCP configuration generator for Windsurf AI Code Editor
 *
 * Generates `mcp_config.json` files for MCP server configuration in Windsurf.
 * Supports both STDIO (local) and SSE (remote) transport types following
 * Windsurf's MCP specification.
 *
 * @see specification-windsurf-mcp.md
 */
export class WindsurfMcp extends ToolMcp {
  private readonly config: WindsurfMcpConfig;

  constructor({ config, ...rest }: WindsurfMcpParams & ConstructorParameters<typeof ToolMcp>[0]) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = WindsurfMcpConfigSchema.safeParse(config);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.config = config;
  }

  getFileName(): string {
    return "mcp_config.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): WindsurfMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to WindsurfMcp
   * Maps RulesyncMcp servers to Windsurf format, handling Windsurf-specific fields
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): WindsurfMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const windsurfConfig: WindsurfMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for windsurf
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "windsurf")) {
        continue;
      }

      const windsurfServer: WindsurfMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport
        if (Array.isArray(rulesyncServer.command)) {
          // Take the first element as command for Windsurf
          windsurfServer.command = rulesyncServer.command[0];
          // Add remaining elements to args
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            windsurfServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            windsurfServer.args = rulesyncServer.args;
          }
        } else {
          windsurfServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            windsurfServer.args = rulesyncServer.args;
          }
        }
      } else if (rulesyncServer.url !== undefined) {
        // SSE transport - Windsurf uses serverUrl field
        windsurfServer.serverUrl = rulesyncServer.url;
      }

      // Map common optional fields
      if (rulesyncServer.env !== undefined) {
        windsurfServer.env = rulesyncServer.env;
      }

      windsurfConfig.mcpServers[serverName] = windsurfServer;
    }

    const fileContent = JSON.stringify(windsurfConfig, null, 2);

    return new WindsurfMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: "mcp_config.json",
      fileContent,
      config: windsurfConfig,
      validate: false,
    });
  }

  validate(): ValidationResult {
    try {
      // First check the base class validation
      const baseResult = super.validate();
      if (!baseResult.success) {
        return baseResult;
      }

      // Check if config is set (may be undefined during construction)
      if (!this.config) {
        return { success: true, error: null };
      }

      const result = WindsurfMcpConfigSchema.safeParse(this.config);
      if (result.success) {
        // Additional validation: ensure at least one server exists
        const serverCount = Object.keys(this.config.mcpServers).length;
        if (serverCount === 0) {
          return {
            success: false,
            error: new Error("At least one MCP server must be defined"),
          };
        }

        // Validate each server has correct transport configuration
        for (const [serverName, serverConfig] of Object.entries(this.config.mcpServers)) {
          const hasStdioConfig = serverConfig.command !== undefined;
          const hasRemoteConfig = serverConfig.serverUrl !== undefined;

          if (!hasStdioConfig && !hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" must have either 'command' (for STDIO) or 'serverUrl' (for SSE) transport configuration`,
              ),
            };
          }

          if (hasStdioConfig && hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" cannot have both STDIO ('command') and remote ('serverUrl') transport configuration`,
              ),
            };
          }
        }

        return { success: true, error: null };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<WindsurfMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = WindsurfMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid Windsurf MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as WindsurfMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new WindsurfMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate: false,
    });
  }
}
