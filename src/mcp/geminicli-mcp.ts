import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import type { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import type { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

// Zod schemas for Gemini CLI MCP configuration
export const GeminicliMcpServerSchema = z.object({
  // STDIO transport fields
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
  cwd: z.optional(z.string()),

  // Remote transport fields (SSE/HTTP)
  url: z.optional(z.string()), // SSE endpoint
  httpUrl: z.optional(z.string()), // HTTP chunked stream endpoint

  // Common optional fields
  env: z.optional(z.record(z.string(), z.string())),
  timeout: z.optional(z.number()), // default: 30000
  trust: z.optional(z.boolean()), // skip confirmation dialogs
});

export const GeminicliMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), GeminicliMcpServerSchema),
});

// Type definitions
export type GeminicliMcpServer = z.infer<typeof GeminicliMcpServerSchema>;
export type GeminicliMcpConfig = z.infer<typeof GeminicliMcpConfigSchema>;

export interface GeminicliMcpParams {
  config: GeminicliMcpConfig;
  baseDir?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  fileContent: string;
  validate?: boolean;
}

/**
 * GeminicliMcp class for managing Gemini CLI MCP configuration
 * Extends ToolMcp to provide Gemini CLI-specific MCP configuration generation
 */
export class GeminicliMcp extends ToolMcp {
  private readonly config: GeminicliMcpConfig;

  constructor({ config, ...rest }: GeminicliMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = GeminicliMcpConfigSchema.safeParse(config);
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
    return ".gemini/settings.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): GeminicliMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to GeminicliMcp
   * Maps RulesyncMcp servers to Gemini CLI format, handling Gemini CLI-specific fields
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): GeminicliMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const geminicliConfig: GeminicliMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for geminicli
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "geminicli")) {
        continue;
      }

      const geminicliServer: GeminicliMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport
        if (Array.isArray(rulesyncServer.command)) {
          // Take the first element as command for Gemini CLI
          geminicliServer.command = rulesyncServer.command[0];
          // Add remaining elements to args
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            geminicliServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            geminicliServer.args = rulesyncServer.args;
          }
        } else {
          geminicliServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            geminicliServer.args = rulesyncServer.args;
          }
        }

        // Map working directory for STDIO
        if (rulesyncServer.cwd !== undefined) {
          geminicliServer.cwd = rulesyncServer.cwd;
        }
      } else if (rulesyncServer.url !== undefined) {
        // Determine transport type based on configuration
        if (rulesyncServer.transport === "sse") {
          geminicliServer.url = rulesyncServer.url; // SSE endpoint
        } else if (rulesyncServer.transport === "http") {
          geminicliServer.httpUrl = rulesyncServer.url; // HTTP streaming endpoint
        } else {
          // Default to SSE for Gemini CLI
          geminicliServer.url = rulesyncServer.url;
        }

        // Note: headers are not supported in Gemini CLI MCP format
      }

      // Map common optional fields
      if (rulesyncServer.env !== undefined) {
        geminicliServer.env = rulesyncServer.env;
      }

      // Map Gemini CLI-specific fields
      if (rulesyncServer.timeout !== undefined) {
        geminicliServer.timeout = rulesyncServer.timeout;
      }
      if (rulesyncServer.alwaysAllow !== undefined) {
        // Map alwaysAllow to trust (true if has auto-approve tools)
        geminicliServer.trust = rulesyncServer.alwaysAllow.length > 0;
      }
      if (rulesyncServer.disabled !== undefined) {
        // Note: Gemini CLI doesn't have disabled field, so we skip disabled servers
        if (rulesyncServer.disabled) {
          continue; // Skip this server
        }
      }

      geminicliConfig.mcpServers[serverName] = geminicliServer;
    }

    const fileContent = JSON.stringify(geminicliConfig, null, 2);

    return new GeminicliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".gemini/settings.json",
      fileContent,
      config: geminicliConfig,
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

      const result = GeminicliMcpConfigSchema.safeParse(this.config);
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
          const hasSSEConfig = serverConfig.url !== undefined;
          const hasHTTPConfig = serverConfig.httpUrl !== undefined;
          const hasRemoteConfig = hasSSEConfig || hasHTTPConfig;

          if (!hasStdioConfig && !hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" must have either 'command' (for STDIO), 'url' (for SSE), or 'httpUrl' (for HTTP) transport configuration`,
              ),
            };
          }

          // Check for conflicting transport configurations
          const configCount = [hasStdioConfig, hasSSEConfig, hasHTTPConfig].filter(Boolean).length;
          if (configCount > 1) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" cannot have multiple transport configurations (command/url/httpUrl are mutually exclusive)`,
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
  }: AiFileFromFilePathParams): Promise<GeminicliMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = GeminicliMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid Gemini CLI MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as GeminicliMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new GeminicliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}
