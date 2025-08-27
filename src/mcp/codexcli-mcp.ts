import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for OpenAI Codex CLI MCP server configuration
 * Codex CLI supports both local (STDIO) and remote (HTTP/SSE) transport types
 * through MCP wrapper servers
 */
export const CodexcliMcpServerSchema = z.object({
  // Transport type
  type: z.optional(z.enum(["local", "remote"])),

  // STDIO transport fields (for wrapper servers)
  command: z.optional(z.array(z.string())),
  enabled: z.optional(z.boolean()),
  environment: z.optional(z.record(z.string(), z.string())),
  cwd: z.optional(z.string()),

  // Remote transport fields (HTTP/SSE)
  url: z.optional(z.string()),
  headers: z.optional(z.record(z.string(), z.string())),

  // Common optional fields
  timeout: z.optional(z.number()),
});

/**
 * Schema for OpenAI Codex CLI MCP configuration
 * Uses opencode.json format with "mcp" object containing server configurations
 */
export const CodexcliMcpConfigSchema = z.object({
  $schema: z.optional(z.string()),
  mcp: z.record(z.string(), CodexcliMcpServerSchema),
});

export type CodexcliMcpServer = z.infer<typeof CodexcliMcpServerSchema>;
export type CodexcliMcpConfig = z.infer<typeof CodexcliMcpConfigSchema>;

export interface CodexcliMcpParams extends AiFileParams {
  config: CodexcliMcpConfig;
}

/**
 * MCP configuration generator for OpenAI Codex CLI
 *
 * Generates `opencode.json` files for MCP server configuration in Codex CLI environments.
 * Codex CLI uses MCP wrapper servers to expose functionality through the Model Context Protocol.
 * Supports both local wrapper servers (Python/Node.js) and remote HTTP/SSE endpoints.
 *
 * @see https://github.com/agency-ai-solutions/openai-codex-mcp
 * @see https://github.com/rmulligan/mcp-openai-codex
 */
export class CodexcliMcp extends ToolMcp {
  private readonly config: CodexcliMcpConfig;

  constructor({ config, ...rest }: CodexcliMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = CodexcliMcpConfigSchema.safeParse(config);
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
    return "opencode.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): CodexcliMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to CodexcliMcp
   * Maps RulesyncMcp servers to Codex CLI format, handling Codex CLI-specific fields
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): CodexcliMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const codexcliConfig: CodexcliMcpConfig = {
      $schema: "https://opencode.ai/config.json",
      mcp: {},
    };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for codexcli
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "codexcli")) {
        continue;
      }

      const codexcliServer: CodexcliMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // STDIO transport - map to local type
        codexcliServer.type = "local";

        if (Array.isArray(rulesyncServer.command)) {
          codexcliServer.command = rulesyncServer.command;
        } else {
          codexcliServer.command = [rulesyncServer.command];
          if (rulesyncServer.args !== undefined) {
            codexcliServer.command = [...codexcliServer.command, ...rulesyncServer.args];
          }
        }
      } else if (rulesyncServer.url !== undefined) {
        // Remote transport (SSE/HTTP)
        codexcliServer.type = "remote";
        codexcliServer.url = rulesyncServer.url;

        // Map headers for remote transport
        if (rulesyncServer.headers !== undefined) {
          codexcliServer.headers = rulesyncServer.headers;
        }
      }

      // Map environment variables to Codex CLI format
      if (rulesyncServer.env !== undefined) {
        codexcliServer.environment = rulesyncServer.env;
      }

      // Map working directory
      if (rulesyncServer.cwd !== undefined) {
        codexcliServer.cwd = rulesyncServer.cwd;
      }

      // Map Codex CLI-specific fields
      if (rulesyncServer.timeout !== undefined) {
        codexcliServer.timeout = rulesyncServer.timeout;
      }
      if (rulesyncServer.disabled !== undefined) {
        codexcliServer.enabled = !rulesyncServer.disabled;
      } else {
        codexcliServer.enabled = true;
      }

      codexcliConfig.mcp[serverName] = codexcliServer;
    }

    const fileContent = JSON.stringify(codexcliConfig, null, 2);

    return new CodexcliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: "opencode.json",
      fileContent,
      config: codexcliConfig,
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

      const result = CodexcliMcpConfigSchema.safeParse(this.config);
      if (result.success) {
        // Additional validation: ensure at least one server exists
        const serverCount = Object.keys(this.config.mcp).length;
        if (serverCount === 0) {
          return {
            success: false,
            error: new Error("At least one MCP server must be defined"),
          };
        }

        // Validate each server has correct transport configuration
        for (const [serverName, serverConfig] of Object.entries(this.config.mcp)) {
          const hasLocalConfig =
            serverConfig.command !== undefined && serverConfig.command.length > 0;
          const hasRemoteConfig = serverConfig.url !== undefined;

          if (!hasLocalConfig && !hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" must have either 'command' (for local) or 'url' (for remote) transport configuration`,
              ),
            };
          }

          if (hasLocalConfig && hasRemoteConfig) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" cannot have both local ('command') and remote ('url') transport configuration`,
              ),
            };
          }

          // Validate type field if present
          if (serverConfig.type !== undefined) {
            if (hasLocalConfig && serverConfig.type !== "local") {
              return {
                success: false,
                error: new Error(
                  `Server "${serverName}" has local configuration but type is not "local"`,
                ),
              };
            }
            if (hasRemoteConfig && serverConfig.type !== "remote") {
              return {
                success: false,
                error: new Error(
                  `Server "${serverName}" has remote configuration but type is not "remote"`,
                ),
              };
            }
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
  }: AiFileFromFilePathParams): Promise<CodexcliMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = CodexcliMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid Codex CLI MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as CodexcliMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new CodexcliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}
