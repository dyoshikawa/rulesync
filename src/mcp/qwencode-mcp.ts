import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for Qwen Code MCP server configuration
 * Qwen Code supports STDIO, SSE, and HTTP transport types
 * Based on Gemini CLI's MCP architecture with Qwen Code specific fields
 */
export const QwencodeMcpServerSchema = z.object({
  // STDIO transport fields
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
  cwd: z.optional(z.string()),

  // Remote transport fields (SSE/HTTP)
  url: z.optional(z.string()),
  httpUrl: z.optional(z.string()), // Qwen Code specific: HTTP streaming endpoint
  type: z.optional(z.enum(["streamable-http", "sse"])),
  headers: z.optional(z.record(z.string(), z.string())),

  // Common optional fields
  env: z.optional(z.record(z.string(), z.string())),
  timeout: z.optional(z.number()),
  disabled: z.optional(z.boolean()),

  // Qwen Code specific fields
  includeTools: z.optional(z.array(z.string())), // Whitelist of tool names
  excludeTools: z.optional(z.array(z.string())), // Blacklist of tool names
  trust: z.optional(z.boolean()), // Bypass all tool call confirmations
});

/**
 * Schema for Qwen Code MCP configuration
 * Qwen Code uses `.qwen/settings.json` files with mcpServers object
 */
export const QwencodeMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), QwencodeMcpServerSchema),
});

export type QwencodeMcpServer = z.infer<typeof QwencodeMcpServerSchema>;
export type QwencodeMcpConfig = z.infer<typeof QwencodeMcpConfigSchema>;

export interface QwencodeMcpParams extends AiFileParams {
  config: QwencodeMcpConfig;
}

/**
 * MCP configuration generator for Qwen Code
 *
 * Generates `.qwen/settings.json` files for MCP server configuration in Qwen Code.
 * Supports both project-scoped and global configurations following
 * Qwen Code's MCP specification based on Gemini CLI architecture.
 */
export class QwencodeMcp extends ToolMcp {
  private readonly config: QwencodeMcpConfig;

  constructor({ config, ...rest }: QwencodeMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = QwencodeMcpConfigSchema.safeParse(config);
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
    return ".qwen/settings.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): QwencodeMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to QwencodeMcp
   * Maps RulesyncMcp servers to Qwen Code format, handling Qwen Code-specific fields
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): QwencodeMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const qwencodeConfig: QwencodeMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for qwencode
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "qwencode")) {
        continue;
      }

      const qwencodeServer: QwencodeMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport
        if (Array.isArray(rulesyncServer.command)) {
          // Take the first element as command for Qwen Code
          qwencodeServer.command = rulesyncServer.command[0];
          // Add remaining elements to args
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            qwencodeServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            qwencodeServer.args = rulesyncServer.args;
          }
        } else {
          qwencodeServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            qwencodeServer.args = rulesyncServer.args;
          }
        }

        // Map cwd for STDIO
        if (rulesyncServer.cwd !== undefined) {
          qwencodeServer.cwd = rulesyncServer.cwd;
        }
      } else if (rulesyncServer.url !== undefined || rulesyncServer.httpUrl !== undefined) {
        // Remote transport (SSE/HTTP)
        if (rulesyncServer.httpUrl !== undefined) {
          // Prefer httpUrl for HTTP streaming
          qwencodeServer.httpUrl = rulesyncServer.httpUrl;
          qwencodeServer.type = "streamable-http";
        } else if (rulesyncServer.url !== undefined) {
          // Use url for SSE
          qwencodeServer.url = rulesyncServer.url;
          qwencodeServer.type = "sse";
        }

        // Map transport type from rulesync format
        if (rulesyncServer.type !== undefined) {
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          qwencodeServer.type = rulesyncServer.type as "streamable-http" | "sse";
        }

        // Map headers for remote transport
        if (rulesyncServer.headers !== undefined) {
          qwencodeServer.headers = rulesyncServer.headers;
        }
      }

      // Map common optional fields
      if (rulesyncServer.env !== undefined) {
        qwencodeServer.env = rulesyncServer.env;
      }

      // Map Qwen Code-specific fields
      if (rulesyncServer.timeout !== undefined) {
        qwencodeServer.timeout = rulesyncServer.timeout;
      }
      if (rulesyncServer.disabled !== undefined) {
        qwencodeServer.disabled = rulesyncServer.disabled;
      }
      if (rulesyncServer.trust !== undefined) {
        qwencodeServer.trust = rulesyncServer.trust;
      }

      // Map tool filtering (includeTools/excludeTools come from rulesync tools/alwaysAllow)
      if (rulesyncServer.tools !== undefined) {
        qwencodeServer.includeTools = rulesyncServer.tools;
      } else if (rulesyncServer.alwaysAllow !== undefined) {
        qwencodeServer.includeTools = rulesyncServer.alwaysAllow;
      }

      qwencodeConfig.mcpServers[serverName] = qwencodeServer;
    }

    const fileContent = JSON.stringify(qwencodeConfig, null, 2);

    return new QwencodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".qwen/settings.json",
      fileContent,
      config: qwencodeConfig,
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

      const result = QwencodeMcpConfigSchema.safeParse(this.config);
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
          const hasRemoteConfig =
            serverConfig.url !== undefined || serverConfig.httpUrl !== undefined;

          if (!hasStdioConfig && !hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" must have either 'command' (for STDIO) or 'url'/'httpUrl' (for remote) transport configuration`,
              ),
            };
          }

          if (hasStdioConfig && hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" cannot have both STDIO ('command') and remote ('url'/'httpUrl') transport configuration`,
              ),
            };
          }

          // Validate that httpUrl and url are not both present
          if (serverConfig.url !== undefined && serverConfig.httpUrl !== undefined) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" cannot have both 'url' and 'httpUrl' fields. Use 'url' for SSE or 'httpUrl' for HTTP streaming`,
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

          // Validate that includeTools and excludeTools are not both present
          if (serverConfig.includeTools !== undefined && serverConfig.excludeTools !== undefined) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" cannot have both 'includeTools' and 'excludeTools'. Use one or the other for tool filtering`,
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
  }: AiFileFromFilePathParams): Promise<QwencodeMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = QwencodeMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid Qwen Code MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as QwencodeMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new QwencodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}
