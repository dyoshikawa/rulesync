import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import type { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import type { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

// Zod schema for Roo MCP server configuration
export const RooMcpServerSchema = z.object({
  // STDIO transport fields
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
  cwd: z.optional(z.string()),

  // Remote transport fields (streamable-http/sse)
  type: z.optional(z.enum(["streamable-http", "sse"])),
  url: z.optional(z.string()),
  headers: z.optional(z.record(z.string(), z.string())),

  // Common optional fields
  env: z.optional(z.record(z.string(), z.string())),
  alwaysAllow: z.optional(z.array(z.string())),
  disabled: z.optional(z.boolean()),
  trust: z.optional(z.boolean()),
  timeout: z.optional(z.number()),
});

// Zod schema for the complete Roo MCP configuration
export const RooMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RooMcpServerSchema),
});

// TypeScript types
export type RooMcpServer = z.infer<typeof RooMcpServerSchema>;
export type RooMcpConfig = z.infer<typeof RooMcpConfigSchema>;
export type RooMcpParams = {
  config: RooMcpConfig;
} & ConstructorParameters<typeof ToolMcp>[0];

/**
 * Roo Code MCP configuration class
 * Generates .roo/mcp.json files for Roo Code MCP server configuration
 */
export class RooMcp extends ToolMcp {
  private readonly config: RooMcpConfig;

  constructor({ config, ...rest }: RooMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = RooMcpConfigSchema.safeParse(config);
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
    return ".roo/mcp.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): RooMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to RooMcp
   * Maps RulesyncMcp servers to Roo Code format, handling Roo Code-specific fields
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): RooMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const rooConfig: RooMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for roo
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "roo")) {
        continue;
      }

      const rooServer: RooMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport
        if (Array.isArray(rulesyncServer.command)) {
          // Take the first element as command for Roo Code
          rooServer.command = rulesyncServer.command[0];
          // Add remaining elements to args
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            rooServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            rooServer.args = rulesyncServer.args;
          }
        } else {
          rooServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            rooServer.args = rulesyncServer.args;
          }
        }

        // Map cwd for STDIO
        if (rulesyncServer.cwd !== undefined) {
          rooServer.cwd = rulesyncServer.cwd;
        }
      } else if (rulesyncServer.url !== undefined) {
        // Remote transport (streamable-http/sse)
        rooServer.url = rulesyncServer.url;

        // Map transport type - Roo uses specific type field
        if (rulesyncServer.transport === "http") {
          rooServer.type = "streamable-http";
        } else if (rulesyncServer.transport === "sse") {
          rooServer.type = "sse";
        } else {
          // Default to streamable-http for remote servers
          rooServer.type = "streamable-http";
        }

        // Map headers for remote transport
        if (rulesyncServer.headers !== undefined) {
          rooServer.headers = rulesyncServer.headers;
        }
      }

      // Map common optional fields
      if (rulesyncServer.env !== undefined) {
        rooServer.env = rulesyncServer.env;
      }

      // Map Roo-specific fields
      if (rulesyncServer.timeout !== undefined) {
        rooServer.timeout = rulesyncServer.timeout;
      }
      if (rulesyncServer.disabled !== undefined) {
        rooServer.disabled = rulesyncServer.disabled;
      }

      // Map alwaysAllow (Roo-specific feature)
      if (rulesyncServer.alwaysAllow !== undefined) {
        rooServer.alwaysAllow = rulesyncServer.alwaysAllow;
      }

      // Map trust field (Roo-specific feature)
      if (rulesyncServer.trust !== undefined) {
        rooServer.trust = rulesyncServer.trust;
      }

      rooConfig.mcpServers[serverName] = rooServer;
    }

    const fileContent = JSON.stringify(rooConfig, null, 2);

    return new RooMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".roo/mcp.json",
      fileContent,
      config: rooConfig,
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

      const result = RooMcpConfigSchema.safeParse(this.config);
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

          // Validate remote server has type field
          if (hasRemoteConfig && !serverConfig.type) {
            return {
              success: false,
              error: new Error(
                `Remote server "${serverName}" must have 'type' field set to "streamable-http" or "sse"`,
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
  }: AiFileFromFilePathParams): Promise<RooMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = RooMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid Roo Code MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as RooMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new RooMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate: false,
    });
  }
}
