import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for Amazon Q CLI MCP server configuration
 * Amazon Q CLI uses "autoApprove" instead of "alwaysAllow"
 */
export const AmazonQCliMcpServerSchema = z.object({
  command: z.optional(z.union([z.string(), z.array(z.string())])),
  args: z.optional(z.array(z.string())),
  env: z.optional(z.record(z.string(), z.string())),
  timeout: z.optional(z.number()),
  disabled: z.optional(z.boolean()),
  autoApprove: z.optional(z.array(z.string())),
});

/**
 * Schema for Amazon Q CLI MCP configuration
 */
export const AmazonQCliMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), AmazonQCliMcpServerSchema),
});

export type AmazonQCliMcpServer = z.infer<typeof AmazonQCliMcpServerSchema>;
export type AmazonQCliMcpConfig = z.infer<typeof AmazonQCliMcpConfigSchema>;

export interface AmazonqcliMcpParams extends AiFileParams {
  config: AmazonQCliMcpConfig;
}

/**
 * AmazonqcliMcp class represents MCP configuration files for Amazon Q Developer CLI.
 * Amazon Q CLI uses .amazonq/mcp.json for project-specific MCP server configurations.
 */
export class AmazonqcliMcp extends ToolMcp {
  private readonly config: AmazonQCliMcpConfig;

  constructor({ config, ...rest }: AmazonqcliMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const result = AmazonQCliMcpConfigSchema.safeParse(config);
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
    return ".amazonq/mcp.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): AmazonQCliMcpConfig {
    return this.config;
  }

  /**
   * Convert a RulesyncMcp instance to AmazonqcliMcp
   * Maps "alwaysAllow" to "autoApprove" (Amazon Q CLI naming convention)
   */
  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): AmazonqcliMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const amazonqConfig: AmazonQCliMcpConfig = { mcpServers: {} };

    // Convert server configurations
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for amazonqcli
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "amazonqcli")) {
        continue;
      }

      const amazonqServer: AmazonQCliMcpServer = {};

      // Map basic fields
      if (rulesyncServer.command !== undefined) {
        amazonqServer.command = rulesyncServer.command;
      }
      if (rulesyncServer.args !== undefined) {
        amazonqServer.args = rulesyncServer.args;
      }
      if (rulesyncServer.env !== undefined) {
        amazonqServer.env = rulesyncServer.env;
      }
      if (rulesyncServer.timeout !== undefined) {
        amazonqServer.timeout = rulesyncServer.timeout;
      }
      if (rulesyncServer.disabled !== undefined) {
        amazonqServer.disabled = rulesyncServer.disabled;
      }

      // Map alwaysAllow to autoApprove (Amazon Q CLI naming)
      if (rulesyncServer.alwaysAllow !== undefined) {
        amazonqServer.autoApprove = rulesyncServer.alwaysAllow;
      }

      amazonqConfig.mcpServers[serverName] = amazonqServer;
    }

    const fileContent = JSON.stringify(amazonqConfig, null, 2);

    return new AmazonqcliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: "mcp.json",
      fileContent,
      config: amazonqConfig,
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

      const result = AmazonQCliMcpConfigSchema.safeParse(this.config);
      if (result.success) {
        // Additional validation: ensure at least one server exists
        const serverCount = Object.keys(this.config.mcpServers).length;
        if (serverCount === 0) {
          return {
            success: false,
            error: new Error("At least one MCP server must be defined"),
          };
        }

        // Validate each server has required command
        for (const [serverName, serverConfig] of Object.entries(this.config.mcpServers)) {
          if (!serverConfig.command) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" must have a 'command' field (Amazon Q CLI only supports STDIO transport)`,
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
  }: AiFileFromFilePathParams): Promise<AmazonqcliMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the configuration
    if (validate) {
      const result = AmazonQCliMcpConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid Amazon Q CLI MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as AmazonQCliMcpConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new AmazonqcliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }
}
