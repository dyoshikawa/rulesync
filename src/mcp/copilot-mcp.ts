import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

/**
 * Schema for GitHub Copilot MCP input configuration (for Editor/Chat format)
 */
export const CopilotMcpInputSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  password: z.optional(z.boolean()),
});

/**
 * Schema for GitHub Copilot MCP server configuration (Coding Agent format)
 */
export const CopilotMcpCodingAgentServerSchema = z.object({
  command: z.string(),
  args: z.optional(z.array(z.string())),
  tools: z.optional(z.array(z.string())),
  type: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
});

/**
 * Schema for GitHub Copilot MCP server configuration (Editor/Chat format)
 */
export const CopilotMcpEditorServerSchema = z.object({
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
  url: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  tools: z.optional(z.array(z.string())),
});

/**
 * Schema for GitHub Copilot Coding Agent MCP configuration
 */
export const CopilotMcpCodingAgentConfigSchema = z.object({
  mcpServers: z.record(z.string(), CopilotMcpCodingAgentServerSchema),
});

/**
 * Schema for GitHub Copilot Editor/Chat MCP configuration
 */
export const CopilotMcpEditorConfigSchema = z.object({
  inputs: z.optional(z.array(CopilotMcpInputSchema)),
  servers: z.record(z.string(), CopilotMcpEditorServerSchema),
});

export type CopilotMcpInput = z.infer<typeof CopilotMcpInputSchema>;
export type CopilotMcpCodingAgentServer = z.infer<typeof CopilotMcpCodingAgentServerSchema>;
export type CopilotMcpEditorServer = z.infer<typeof CopilotMcpEditorServerSchema>;
export type CopilotMcpCodingAgentConfig = z.infer<typeof CopilotMcpCodingAgentConfigSchema>;
export type CopilotMcpEditorConfig = z.infer<typeof CopilotMcpEditorConfigSchema>;

export interface CopilotMcpParams extends AiFileParams {
  config: CopilotMcpCodingAgentConfig | CopilotMcpEditorConfig;
  format: "coding-agent" | "editor";
}

/**
 * CopilotMcp class represents MCP configuration files for GitHub Copilot.
 * GitHub Copilot supports two configuration formats:
 * - Coding Agent: JSON configuration pasted in GitHub.com UI
 * - Editor/Chat: .vscode/mcp.json for VS Code integration
 */
export class CopilotMcp extends ToolMcp {
  tool = "copilot" as const;
  shortName = "cp";
  processorType = "mcp" as const;

  private readonly config: CopilotMcpCodingAgentConfig | CopilotMcpEditorConfig;
  private readonly format: "coding-agent" | "editor";

  constructor({ config, format, ...rest }: CopilotMcpParams) {
    // Validate configuration before calling super
    if (rest.validate !== false) {
      const schema =
        format === "coding-agent"
          ? CopilotMcpCodingAgentConfigSchema
          : CopilotMcpEditorConfigSchema;
      const result = schema.safeParse(config);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.config = config;
    this.format = format;
  }

  getFileName(): string {
    return this.format === "coding-agent" ? "copilot-coding-agent.json" : ".vscode/mcp.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config);
  }

  getConfig(): CopilotMcpCodingAgentConfig | CopilotMcpEditorConfig {
    return this.config;
  }

  getFormat(): "coding-agent" | "editor" {
    return this.format;
  }

  /**
   * Convert a RulesyncMcp instance to CopilotMcp with Coding Agent format
   */
  static fromRulesyncMcpCodingAgent(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): CopilotMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const copilotConfig: CopilotMcpCodingAgentConfig = { mcpServers: {} };

    // Convert server configurations for Coding Agent format
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for copilot
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "copilot")) {
        continue;
      }

      const copilotServer: CopilotMcpCodingAgentServer = {
        command: Array.isArray(rulesyncServer.command)
          ? rulesyncServer.command[0] || "echo"
          : rulesyncServer.command || "echo",
      };

      // Map args (combining command array if needed)
      if (Array.isArray(rulesyncServer.command) && rulesyncServer.command.length > 1) {
        // If command was an array, use the rest as args
        const commandArgs = rulesyncServer.command.slice(1);
        copilotServer.args = rulesyncServer.args
          ? [...commandArgs, ...rulesyncServer.args]
          : commandArgs;
      } else if (rulesyncServer.args !== undefined) {
        copilotServer.args = rulesyncServer.args;
      }
      if (rulesyncServer.env !== undefined) {
        copilotServer.env = rulesyncServer.env;
      }

      // Set tools (Coding Agent uses tools field instead of alwaysAllow)
      if (rulesyncServer.alwaysAllow !== undefined && rulesyncServer.alwaysAllow.length > 0) {
        copilotServer.tools = rulesyncServer.alwaysAllow;
      } else {
        copilotServer.tools = ["*"];
      }

      // Set type (Coding Agent only supports "local" type)
      copilotServer.type = "local";

      copilotConfig.mcpServers[serverName] = copilotServer;
    }

    const fileContent = JSON.stringify(copilotConfig, null, 2);

    return new CopilotMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: "copilot-coding-agent.json",
      fileContent,
      config: copilotConfig,
      format: "coding-agent",
    });
  }

  /**
   * Convert a RulesyncMcp instance to CopilotMcp with Editor format
   */
  static fromRulesyncMcpEditor(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): CopilotMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const copilotConfig: CopilotMcpEditorConfig = { servers: {} };

    // Convert server configurations for Editor format
    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      // Check if this server should be included for copilot
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "copilot")) {
        continue;
      }

      const copilotServer: CopilotMcpEditorServer = {};

      // Map basic fields
      if (rulesyncServer.command !== undefined) {
        copilotServer.command = Array.isArray(rulesyncServer.command)
          ? rulesyncServer.command[0] || "echo"
          : rulesyncServer.command;
      }
      // Map args (combining command array if needed)
      if (Array.isArray(rulesyncServer.command) && rulesyncServer.command.length > 1) {
        // If command was an array, use the rest as args
        const commandArgs = rulesyncServer.command.slice(1);
        copilotServer.args = rulesyncServer.args
          ? [...commandArgs, ...rulesyncServer.args]
          : commandArgs;
      } else if (rulesyncServer.args !== undefined) {
        copilotServer.args = rulesyncServer.args;
      }
      if (rulesyncServer.url !== undefined) {
        copilotServer.url = rulesyncServer.url;
      }
      if (rulesyncServer.env !== undefined) {
        copilotServer.env = rulesyncServer.env;
      }

      // Set tools (Editor format supports tools field)
      if (rulesyncServer.alwaysAllow !== undefined && rulesyncServer.alwaysAllow.length > 0) {
        copilotServer.tools = rulesyncServer.alwaysAllow;
      } else {
        copilotServer.tools = ["*"];
      }

      copilotConfig.servers[serverName] = copilotServer;
    }

    const fileContent = JSON.stringify(copilotConfig, null, 2);

    return new CopilotMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: "mcp.json",
      fileContent,
      config: copilotConfig,
      format: "editor",
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

      // Validate based on format
      const schema =
        this.format === "coding-agent"
          ? CopilotMcpCodingAgentConfigSchema
          : CopilotMcpEditorConfigSchema;
      const result = schema.safeParse(this.config);

      if (result.success) {
        // Additional validation: ensure at least one server exists
        const servers =
          this.format === "coding-agent"
            ? // eslint-disable-next-line no-type-assertion/no-type-assertion
              (this.config as CopilotMcpCodingAgentConfig).mcpServers
            : // eslint-disable-next-line no-type-assertion/no-type-assertion
              (this.config as CopilotMcpEditorConfig).servers;

        const serverCount = Object.keys(servers).length;
        if (serverCount === 0) {
          return {
            success: false,
            error: new Error("At least one MCP server must be defined"),
          };
        }

        // Validate each server has required command for STDIO transport
        for (const [serverName, serverConfig] of Object.entries(servers)) {
          if (!serverConfig.command && !serverConfig.url) {
            return {
              success: false,
              error: new Error(
                `Server "${serverName}" must have either a 'command' field (for STDIO transport) or 'url' field (for HTTP/SSE transport)`,
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
  }: AiFileFromFilePathParams): Promise<CopilotMcp> {
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Determine format based on file structure
    const format: "coding-agent" | "editor" = "mcpServers" in rawConfig ? "coding-agent" : "editor";

    // Validate the configuration
    if (validate) {
      const schema =
        format === "coding-agent"
          ? CopilotMcpCodingAgentConfigSchema
          : CopilotMcpEditorConfigSchema;
      const result = schema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(
          `Invalid GitHub Copilot MCP configuration in ${filePath}: ${result.error.message}`,
        );
      }
    }

    // Use the raw config (validated if validate=true)
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as CopilotMcpCodingAgentConfig | CopilotMcpEditorConfig;

    const fileContent = await readFile(filePath, "utf-8");

    return new CopilotMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      format,
      validate,
    });
  }
}
