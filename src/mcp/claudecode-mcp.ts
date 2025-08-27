import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for Claude Code MCP server configuration
 * Claude Code supports STDIO, SSE, and HTTP transport types
 */
export const ClaudecodeMcpServerSchema = z.object({
  // STDIO transport fields
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),

  // Remote transport fields (SSE/HTTP)
  url: z.optional(z.string()),
  transport: z.optional(z.enum(["stdio", "sse", "http"])),
  headers: z.optional(z.record(z.string(), z.string())),

  // Common optional fields
  env: z.optional(z.record(z.string(), z.string())),
  timeout: z.optional(z.number()),
  disabled: z.optional(z.boolean()),
});

/**
 * Schema for Claude Code MCP configuration
 * Claude Code uses `.mcp.json` files with mcpServers object
 */
export const ClaudecodeMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), ClaudecodeMcpServerSchema),
});

export type ClaudecodeMcpServer = z.infer<typeof ClaudecodeMcpServerSchema>;
export type ClaudecodeMcpConfig = z.infer<typeof ClaudecodeMcpConfigSchema>;

export interface ClaudecodeMcpParams extends AiFileParams {
  config: ClaudecodeMcpConfig;
}

/**
 * MCP configuration generator for Claude Code
 *
 * Generates `.mcp.json` files for MCP server configuration in Claude Code.
 * Supports both project-scoped and global configurations following
 * Claude Code's MCP specification.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code/mcp
 */
export class ClaudecodeMcp extends ToolMcp {
  private readonly config: ClaudecodeMcpConfig;

  constructor({ config, ...rest }: ClaudecodeMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = ClaudecodeMcpConfigSchema.safeParse(config);
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
    return ".mcp.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): ClaudecodeMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to ClaudecodeMcp
   * Maps RulesyncMcp servers to Claude Code format, handling Claude Code-specific fields
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): ClaudecodeMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const claudecodeConfig: ClaudecodeMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for claudecode
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "claudecode")) {
        continue;
      }

      const claudecodeServer: ClaudecodeMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport
        if (Array.isArray(rulesyncServer.command)) {
          // Take the first element as command for Claude Code
          claudecodeServer.command = rulesyncServer.command[0];
          // Add remaining elements to args
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            claudecodeServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            claudecodeServer.args = rulesyncServer.args;
          }
        } else {
          claudecodeServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            claudecodeServer.args = rulesyncServer.args;
          }
        }
      } else if (rulesyncServer.url !== undefined) {
        // Remote transport (SSE/HTTP)
        claudecodeServer.url = rulesyncServer.url;

        // Map transport type
        if (rulesyncServer.transport !== undefined) {
          // eslint-disable-next-line no-type-assertion/no-type-assertion
          claudecodeServer.transport = rulesyncServer.transport as "stdio" | "sse" | "http";
        }

        // Map headers for remote transport
        if (rulesyncServer.headers !== undefined) {
          claudecodeServer.headers = rulesyncServer.headers;
        }
      }

      // Map common optional fields
      if (rulesyncServer.env !== undefined) {
        claudecodeServer.env = rulesyncServer.env;
      }

      // Map Claude Code-specific fields
      if (rulesyncServer.timeout !== undefined) {
        claudecodeServer.timeout = rulesyncServer.timeout;
      }
      if (rulesyncServer.disabled !== undefined) {
        claudecodeServer.disabled = rulesyncServer.disabled;
      }

      claudecodeConfig.mcpServers[serverName] = claudecodeServer;
    }

    const fileContent = JSON.stringify(claudecodeConfig, null, 2);

    return new ClaudecodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".mcp.json",
      fileContent,
      config: claudecodeConfig,
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

      const result = ClaudecodeMcpConfigSchema.safeParse(this.config);
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
  }: AiFileFromFilePathParams): Promise<ClaudecodeMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = ClaudecodeMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid Claude Code MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as ClaudecodeMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new ClaudecodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}
