import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for Cline MCP server configuration
 * Cline supports STDIO and SSE transport types with specific Cline features
 */
export const ClineMcpServerSchema = z.object({
  // STDIO transport fields
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),

  // SSE transport fields
  url: z.optional(z.string()),
  headers: z.optional(z.record(z.string(), z.string())),

  // Common optional fields
  env: z.optional(z.record(z.string(), z.string())),

  // Cline-specific fields
  alwaysAllow: z.optional(z.array(z.string())),
  disabled: z.optional(z.boolean()),
  networkTimeout: z.optional(z.number()),
});

/**
 * Schema for Cline MCP configuration
 */
export const ClineMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), ClineMcpServerSchema),
});

export type ClineMcpServer = z.infer<typeof ClineMcpServerSchema>;
export type ClineMcpConfig = z.infer<typeof ClineMcpConfigSchema>;

export interface ClineMcpParams extends AiFileParams {
  config: ClineMcpConfig;
}

/**
 * ClineMcp class represents MCP configuration files for Cline VSCode Extension.
 * Cline supports both global and per-project MCP server configurations.
 */
export class ClineMcp extends ToolMcp {
  private readonly config: ClineMcpConfig;

  constructor({ config, ...rest }: ClineMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = ClineMcpConfigSchema.safeParse(config);
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
    return ".cline/mcp.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): ClineMcpConfig {
    return this.config;
  }

  /**
   * Get the global configuration path for Cline MCP settings.
   * Returns platform-specific path based on VS Code global storage location.
   */
  static getGlobalConfigPath(): string | null {
    const platform = process.platform;

    switch (platform) {
      case "darwin": // macOS
        return process.env.HOME
          ? `${process.env.HOME}/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
          : null;

      case "win32": // Windows
        return process.env.APPDATA
          ? `${process.env.APPDATA}/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
          : null;

      case "linux": // Linux
        // Check for VS Code Server first
        if (process.env.VSCODE_AGENT_FOLDER) {
          return process.env.HOME
            ? `${process.env.HOME}/.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
            : null;
        }
        // Standard Linux path
        return process.env.HOME
          ? `${process.env.HOME}/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
          : null;

      default:
        return null;
    }
  }

  /**
   * Convert a RulesyncMcp instance to ClineMcp
   * Maps RulesyncMcp servers to Cline format, handling Cline-specific fields
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".cline",
  ): ClineMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const clineConfig: ClineMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for cline
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "cline")) {
        continue;
      }

      const clineServer: ClineMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport
        if (Array.isArray(rulesyncServer.command)) {
          // Take the first element as command for Cline
          clineServer.command = rulesyncServer.command[0];
          // Add remaining elements to args
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            clineServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            clineServer.args = rulesyncServer.args;
          }
        } else {
          clineServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            clineServer.args = rulesyncServer.args;
          }
        }
      } else if (rulesyncServer.url !== undefined) {
        // SSE transport
        clineServer.url = rulesyncServer.url;

        // Map headers for SSE
        if (rulesyncServer.headers !== undefined) {
          clineServer.headers = rulesyncServer.headers;
        }
      }

      // Map common optional fields
      if (rulesyncServer.env !== undefined) {
        clineServer.env = rulesyncServer.env;
      }

      // Map Cline-specific fields
      if (rulesyncServer.alwaysAllow !== undefined) {
        clineServer.alwaysAllow = rulesyncServer.alwaysAllow;
      }
      if (rulesyncServer.disabled !== undefined) {
        clineServer.disabled = rulesyncServer.disabled;
      }
      if (rulesyncServer.networkTimeout !== undefined) {
        clineServer.networkTimeout = rulesyncServer.networkTimeout;
      }

      clineConfig.mcpServers[serverName] = clineServer;
    }

    const fileContent = JSON.stringify(clineConfig, null, 2);

    return new ClineMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: "mcp.json",
      fileContent,
      config: clineConfig,
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

      const result = ClineMcpConfigSchema.safeParse(this.config);
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
                `Server "${serverName}" must have either 'command' (for STDIO) or 'url' (for SSE) transport configuration`,
              ),
            };
          }

          if (hasStdioConfig && hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" cannot have both STDIO ('command') and SSE ('url') transport configuration`,
              ),
            };
          }

          // Validate networkTimeout range if present
          if (serverConfig.networkTimeout !== undefined) {
            const timeout = serverConfig.networkTimeout;
            const minTimeout = 30 * 1000; // 30 seconds
            const maxTimeout = 60 * 60 * 1000; // 1 hour
            if (timeout < minTimeout || timeout > maxTimeout) {
              return {
                success: false,
                error: new Error(
                  `Server "${serverName}" networkTimeout must be between 30 seconds (30000) and 1 hour (3600000)`,
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
  }: AiFileFromFilePathParams): Promise<ClineMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = ClineMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(`Invalid Cline MCP configuration in ${filePath}: ${result.error.message}`);
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as ClineMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new ClineMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}
