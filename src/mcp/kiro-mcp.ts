import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { McpTransportTypeSchema } from "../types/mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for Kiro MCP server configuration
 * Kiro supports STDIO, SSE, and streamable-HTTP transport types with AWS integration
 */
export const KiroMcpServerSchema = z.object({
  // STDIO transport fields
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),

  // Remote transport fields (SSE/HTTP)
  url: z.optional(z.string()),
  transport: z.optional(McpTransportTypeSchema),

  // Common optional fields
  env: z.optional(z.record(z.string(), z.string())),
  timeout: z.optional(z.number()),
  disabled: z.optional(z.boolean()),

  // Kiro-specific security configuration
  autoApprove: z.optional(z.array(z.string())),
  autoBlock: z.optional(z.array(z.string())),
  // Alternative spellings also accepted
  autoapprove: z.optional(z.array(z.string())),
  autoblock: z.optional(z.array(z.string())),
});

/**
 * Schema for Kiro MCP configuration
 * Kiro uses `.kiro/mcp.json` files with mcpServers object
 */
export const KiroMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), KiroMcpServerSchema),
});

export type KiroMcpServer = z.infer<typeof KiroMcpServerSchema>;
export type KiroMcpConfig = z.infer<typeof KiroMcpConfigSchema>;

export interface KiroMcpParams extends AiFileParams {
  config: KiroMcpConfig;
}

/**
 * MCP configuration generator for Kiro IDE
 *
 * Generates `.kiro/mcp.json` files for MCP server configuration in Kiro IDE.
 * Supports both workspace-specific and global configurations following
 * Kiro's MCP specification with AWS integration features.
 *
 * @see https://docs.kiro.ai/mcp-configuration
 */
export class KiroMcp extends ToolMcp {
  private readonly config: KiroMcpConfig;

  constructor({ config, ...rest }: KiroMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = KiroMcpConfigSchema.safeParse(config);
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
    return ".kiro/mcp.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): KiroMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to KiroMcp
   * Maps RulesyncMcp servers to Kiro format, handling Kiro-specific fields
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): KiroMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const kiroConfig: KiroMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for kiro
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "kiro")) {
        continue;
      }

      const kiroServer: KiroMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport
        if (Array.isArray(rulesyncServer.command)) {
          // Take the first element as command for Kiro
          kiroServer.command = rulesyncServer.command[0];
          // Add remaining elements to args
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            kiroServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            kiroServer.args = rulesyncServer.args;
          }
        } else {
          kiroServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            kiroServer.args = rulesyncServer.args;
          }
        }
      } else if (rulesyncServer.url !== undefined) {
        // Remote transport (SSE/HTTP)
        kiroServer.url = rulesyncServer.url;

        // Map transport type - handle Kiro's streamable-http
        if (rulesyncServer.transport !== undefined) {
          if (rulesyncServer.transport === "http") {
            // Map http to streamable-http for Kiro
            kiroServer.transport = "streamable-http";
          } else {
            kiroServer.transport = rulesyncServer.transport;
          }
        }
      }

      // Map common optional fields
      if (rulesyncServer.env !== undefined) {
        kiroServer.env = rulesyncServer.env;
      }

      // Map Kiro-specific fields
      if (rulesyncServer.timeout !== undefined) {
        kiroServer.timeout = rulesyncServer.timeout;
      }
      if (rulesyncServer.disabled !== undefined) {
        kiroServer.disabled = rulesyncServer.disabled;
      }

      // Map Kiro security configuration (autoApprove/autoBlock)
      if (rulesyncServer.autoApprove !== undefined) {
        kiroServer.autoApprove = rulesyncServer.autoApprove;
      }
      if (rulesyncServer.autoBlock !== undefined) {
        kiroServer.autoBlock = rulesyncServer.autoBlock;
      }

      kiroConfig.mcpServers[serverName] = kiroServer;
    }

    const fileContent = JSON.stringify(kiroConfig, null, 2);

    return new KiroMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".kiro/mcp.json",
      fileContent,
      config: kiroConfig,
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

      const result = KiroMcpConfigSchema.safeParse(this.config);
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
          const hasRemoteConfig = serverConfig.url !== undefined;

          if (!hasStdioConfig && !hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" must have either 'command' (for STDIO) or 'url' (for remote) transport configuration`,
              ),
            };
          }

          if (hasStdioConfig && hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" cannot have both STDIO ('command') and remote ('url') transport configuration`,
              ),
            };
          }

          // Validate timeout range if present
          if (serverConfig.timeout !== undefined) {
            const timeout = serverConfig.timeout;
            const minTimeout = 1000; // 1 second
            const maxTimeout = 10 * 60 * 1000; // 10 minutes
            if (timeout < minTimeout || timeout > maxTimeout) {
              return {
                success: false,
                error: new Error(
                  `Server "${serverName}" timeout must be between 1 second (1000) and 10 minutes (600000)`,
                ),
              };
            }
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
  }: AiFileFromFilePathParams): Promise<KiroMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = KiroMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid Kiro MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as KiroMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new KiroMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}