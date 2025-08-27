import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for OpenAI Codex CLI MCP server configuration
 * Codex CLI uses wrapper servers (Python/Node.js) that expose MCP functionality
 */
export const CodexcliMcpServerSchema = z.object({
  // Local MCP server configuration (STDIO transport)
  type: z.optional(z.enum(["local", "remote"])),
  command: z.optional(z.union([z.string(), z.array(z.string())])),
  args: z.optional(z.array(z.string())),
  enabled: z.optional(z.boolean()),
  environment: z.optional(z.record(z.string(), z.string())),
  cwd: z.optional(z.string()),

  // Remote MCP server configuration (HTTP/WebSocket transport)
  url: z.optional(z.string()),
  headers: z.optional(z.record(z.string(), z.string())),
});

/**
 * Schema for OpenAI Codex CLI MCP configuration
 * Configuration structure based on opencode.json format
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
 * Generates MCP configuration for OpenAI Codex CLI in opencode.json format.
 * Since Codex CLI doesn't natively support MCP servers, this configuration
 * is for wrapper servers that expose Codex CLI functionality via MCP.
 *
 * Supports:
 * - Python MCP servers (agency-ai-solutions/openai-codex-mcp)
 * - Node.js/TypeScript MCP servers (rmulligan/mcp-openai-codex)
 * - Docker-based MCP servers
 *
 * Configuration can be placed in:
 * - Global: ~/.config/opencode/opencode.json
 * - Project: opencode.json in project root
 * - Custom: Set via OPENCODE_CONFIG environment variable
 *
 * @see OpenAI Codex CLI documentation
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
   * Maps RulesyncMcp servers to Codex CLI wrapper server format
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): CodexcliMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const codexcliConfig: CodexcliMcpConfig = { mcp: {} };

    // Add schema reference
    codexcliConfig["$schema"] = "https://opencode.ai/config.json";

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for codexcli
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "codexcli")) {
        continue;
      }

      const codexcliServer: CodexcliMcpServer = {};

      // Map based on transport type
      if (rulesyncServer.command !== undefined) {
        // Local MCP server (STDIO transport)
        codexcliServer.type = "local";

        // Handle command array or string
        if (Array.isArray(rulesyncServer.command)) {
          codexcliServer.command = rulesyncServer.command;
        } else {
          codexcliServer.command = [rulesyncServer.command];
        }

        if (rulesyncServer.args !== undefined) {
          codexcliServer.args = rulesyncServer.args;
        }

        // Map environment variables
        if (rulesyncServer.env !== undefined) {
          codexcliServer.environment = rulesyncServer.env;
        }

        // Map working directory
        if (rulesyncServer.cwd !== undefined) {
          codexcliServer.cwd = rulesyncServer.cwd;
        }

        // Map enabled status (defaults to true if not specified)
        codexcliServer.enabled = rulesyncServer.disabled !== true;
      } else if (rulesyncServer.url !== undefined) {
        // Remote MCP server (HTTP/WebSocket transport)
        codexcliServer.type = "remote";
        codexcliServer.url = rulesyncServer.url;

        // Map headers for remote transport
        if (rulesyncServer.headers !== undefined) {
          codexcliServer.headers = rulesyncServer.headers;
        }

        // Map enabled status
        codexcliServer.enabled = rulesyncServer.disabled !== true;
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
            serverConfig.command !== undefined || serverConfig.type === "local";
          const hasRemoteConfig = serverConfig.url !== undefined || serverConfig.type === "remote";

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

          // Validate that local servers have command defined
          if (serverConfig.type === "local" && !serverConfig.command) {
            return {
              success: false,
              error: new Error(`Local server "${serverName}" must have 'command' defined`),
            };
          }

          // Validate that remote servers have url defined
          if (serverConfig.type === "remote" && !serverConfig.url) {
            return {
              success: false,
              error: new Error(`Remote server "${serverName}" must have 'url' defined`),
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
  }: AiFileFromFilePathParams): Promise<CodexcliMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Extract MCP section if it's a full opencode.json file
    let mcpConfig: CodexcliMcpConfig;
    if (rawConfig.mcp && typeof rawConfig.mcp === "object") {
      // This is the expected format with MCP section
      mcpConfig = {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        $schema: rawConfig["$schema"] as string | undefined,
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        mcp: rawConfig.mcp as Record<string, CodexcliMcpServer>,
      };
    } else if (rawConfig["$schema"] || Object.keys(rawConfig).some((key) => key !== "mcp")) {
      // This might be a full opencode.json, extract only MCP section
      mcpConfig = {
        $schema: rawConfig["$schema"] !== undefined ? String(rawConfig["$schema"]) : undefined,
        mcp:
          rawConfig.mcp && typeof rawConfig.mcp === "object"
            ? // eslint-disable-next-line no-type-assertion/no-type-assertion
              (rawConfig.mcp as Record<string, CodexcliMcpServer>)
            : {},
      };
    } else {
      // Assume the entire config is the MCP section
      mcpConfig = {
        mcp:
          typeof rawConfig === "object" && rawConfig !== null
            ? // eslint-disable-next-line no-type-assertion/no-type-assertion
              (rawConfig as Record<string, CodexcliMcpServer>)
            : {},
      };
    }

    // Validate the configuration
    if (validate) {
      const result = CodexcliMcpConfigSchema.safeParse(mcpConfig);
      if (!result.success) {
        throw new Error(
          `Invalid OpenAI Codex CLI MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    const fileContent = await readFile(filePath, "utf-8");

    return new CodexcliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config: mcpConfig,
      validate,
    });
  }
}
