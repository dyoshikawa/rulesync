import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import type { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for AugmentCode MCP server configuration
 */
export const AugmentcodeMcpServerSchema = z.object({
  name: z.string(),
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
  url: z.optional(z.string()),
  transport: z.optional(z.enum(["sse", "http"])),
  headers: z.optional(z.record(z.string(), z.string())),
  env: z.optional(z.record(z.string(), z.string())),
  timeout: z.optional(z.number()),
  enabled: z.optional(z.boolean()),
  retries: z.optional(z.number()),
});

/**
 * Schema for AugmentCode MCP configuration
 * Supports both VS Code settings format and standard .mcp.json format
 */
export const AugmentcodeMcpConfigSchema = z.union([
  z.object({
    "augment.advanced": z.object({
      mcpServers: z.array(AugmentcodeMcpServerSchema),
    }),
  }),
  z.object({
    mcpServers: z.record(z.string(), z.omit(AugmentcodeMcpServerSchema, { name: true })),
  }),
]);

export type AugmentcodeMcpServer = z.infer<typeof AugmentcodeMcpServerSchema>;
export type AugmentcodeMcpConfig = z.infer<typeof AugmentcodeMcpConfigSchema>;

export interface AugmentcodeMcpParams extends AiFileParams {
  config: AugmentcodeMcpConfig;
}

/**
 * AugmentcodeMcp class represents MCP configuration files for AugmentCode.
 * AugmentCode supports both VS Code settings format and standard .mcp.json format.
 */
export class AugmentcodeMcp extends ToolMcp {
  private readonly config: AugmentcodeMcpConfig;

  constructor({ config, ...rest }: AugmentcodeMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = AugmentcodeMcpConfigSchema.safeParse(config);
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

  getConfig(): AugmentcodeMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to AugmentcodeMcp
   * Creates standard .mcp.json format configuration
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): AugmentcodeMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const augmentConfig: { mcpServers: Record<string, Omit<AugmentcodeMcpServer, "name">> } = {
      mcpServers: {},
    };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for augmentcode
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "augmentcode")) {
        continue;
      }

      const augmentServer: Omit<AugmentcodeMcpServer, "name"> = {};

      // Handle STDIO transport
      if (rulesyncServer.command) {
        const command = Array.isArray(rulesyncServer.command)
          ? rulesyncServer.command[0]
          : rulesyncServer.command;
        if (command) {
          augmentServer.command = command;
        }
        if (rulesyncServer.args) {
          augmentServer.args = rulesyncServer.args;
        }
        if (rulesyncServer.env) {
          augmentServer.env = rulesyncServer.env;
        }
      }
      // Handle remote transports (SSE/HTTP)
      else if (rulesyncServer.url || rulesyncServer.httpUrl) {
        const url = rulesyncServer.httpUrl || rulesyncServer.url;
        if (url) {
          augmentServer.url = url;
        }

        // Set transport type based on configuration
        if (rulesyncServer.httpUrl || rulesyncServer.transport === "http") {
          augmentServer.transport = "http";
        } else if (rulesyncServer.transport === "sse") {
          augmentServer.transport = "sse";
        }

        // For remote servers, env variables become headers
        if (rulesyncServer.env) {
          augmentServer.headers = rulesyncServer.env;
        }
        if (rulesyncServer.headers) {
          augmentServer.headers = { ...augmentServer.headers, ...rulesyncServer.headers };
        }
      }

      // Add optional fields
      if (rulesyncServer.timeout !== undefined) {
        augmentServer.timeout = rulesyncServer.timeout;
      }

      // Map disabled to enabled (inverted)
      if (rulesyncServer.disabled !== undefined) {
        augmentServer.enabled = !rulesyncServer.disabled;
      }

      // Add retries based on networkTimeout
      if (rulesyncServer.networkTimeout && rulesyncServer.networkTimeout > 0) {
        augmentServer.retries = Math.max(1, Math.floor(rulesyncServer.networkTimeout / 30000));
      }

      augmentConfig.mcpServers[serverName] = augmentServer;
    }

    const fileContent = JSON.stringify(augmentConfig, null, 2);

    return new AugmentcodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: "mcp.json",
      fileContent,
      config: augmentConfig,
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

      const result = AugmentcodeMcpConfigSchema.safeParse(this.config);
      if (result.success) {
        // Additional validation: ensure at least one server exists
        let serverCount = 0;

        if ("augment.advanced" in this.config) {
          serverCount = this.config["augment.advanced"].mcpServers.length;
        } else {
          serverCount = Object.keys(this.config.mcpServers).length;
        }

        if (serverCount === 0) {
          return {
            success: false,
            error: new Error("At least one MCP server must be defined"),
          };
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
  }: AiFileFromFilePathParams): Promise<AugmentcodeMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = AugmentcodeMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid AugmentCode MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as AugmentcodeMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new AugmentcodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}
