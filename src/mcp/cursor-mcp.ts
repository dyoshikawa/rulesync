import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for Cursor MCP server configuration
 * Cursor supports multiple transport types: stdio, sse, streamable-http
 */
export const CursorMcpServerSchema = z.object({
  // STDIO transport fields
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),

  // Remote transport fields
  url: z.optional(z.string()),
  type: z.optional(z.enum(["sse", "streamable-http"])),

  // Common optional fields
  env: z.optional(z.record(z.string(), z.string())),
  cwd: z.optional(z.string()),
});

/**
 * Schema for Cursor MCP configuration
 */
export const CursorMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), CursorMcpServerSchema),
});

export type CursorMcpServer = z.infer<typeof CursorMcpServerSchema>;
export type CursorMcpConfig = z.infer<typeof CursorMcpConfigSchema>;

export interface CursorMcpParams extends AiFileParams {
  config: CursorMcpConfig;
}

/**
 * CursorMcp class represents MCP configuration files for Cursor IDE.
 * Cursor uses .cursor/mcp.json for project-specific MCP server configurations.
 */
export class CursorMcp extends ToolMcp {
  private readonly config: CursorMcpConfig;

  constructor({ config, ...rest }: CursorMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = CursorMcpConfigSchema.safeParse(config);
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
    return ".cursor/mcp.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): CursorMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to CursorMcp
   * Maps RulesyncMcp servers to Cursor format, handling different transport types
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): CursorMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const cursorConfig: CursorMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for cursor
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "cursor")) {
        continue;
      }

      const cursorServer: CursorMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport
        if (Array.isArray(rulesyncServer.command)) {
          // Take the first element as command for Cursor
          cursorServer.command = rulesyncServer.command[0];
          // Add remaining elements to args
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            cursorServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            cursorServer.args = rulesyncServer.args;
          }
        } else {
          cursorServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            cursorServer.args = rulesyncServer.args;
          }
        }
      } else if (rulesyncServer.url !== undefined) {
        // Remote transport (SSE or streamable-http)
        cursorServer.url = rulesyncServer.url;

        // Map transport type
        if (rulesyncServer.type === "sse" || rulesyncServer.transport === "sse") {
          cursorServer.type = "sse";
        } else if (
          rulesyncServer.type === "streamable-http" ||
          rulesyncServer.transport === "http"
        ) {
          cursorServer.type = "streamable-http";
        }
      } else if (rulesyncServer.httpUrl !== undefined) {
        // Handle httpUrl -> url mapping for streamable-http
        cursorServer.url = rulesyncServer.httpUrl;
        cursorServer.type = "streamable-http";
      }

      // Map common optional fields
      if (rulesyncServer.env !== undefined) {
        cursorServer.env = rulesyncServer.env;
      }
      if (rulesyncServer.cwd !== undefined) {
        cursorServer.cwd = rulesyncServer.cwd;
      }

      // Note: Cursor doesn't support alwaysAllow, disabled, timeout fields
      // These are simply omitted in the conversion

      cursorConfig.mcpServers[serverName] = cursorServer;
    }

    const fileContent = JSON.stringify(cursorConfig, null, 2);

    return new CursorMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: "mcp.json",
      fileContent,
      config: cursorConfig,
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

      const result = CursorMcpConfigSchema.safeParse(this.config);
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

          // For remote servers, type field is recommended
          if (hasRemoteConfig && !serverConfig.type) {
            // This is a warning, not an error - type can be inferred
            // But we don't return a warning, just note it for potential future enhancement
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
  }: AiFileFromFilePathParams): Promise<CursorMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = CursorMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(`Invalid Cursor MCP configuration in ${filePath}: ${result.error.message}`);
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as CursorMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new CursorMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}
