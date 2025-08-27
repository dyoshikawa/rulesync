import { readFile } from "node:fs/promises";
import type { AiFileFromFilePathParams, AiFileParams } from "../types/ai-file.js";
import type { McpConfig, McpServerBase } from "../types/mcp.js";
import { ToolMcp } from "./tool-mcp.js";

export interface OpencodeMcpParams extends AiFileParams {
  config?: McpConfig;
}

/**
 * OpenCode MCP configuration generator.
 *
 * Generates MCP configuration files for OpenCode AI coding agent.
 * Supports both local STDIO servers and remote HTTP/SSE servers.
 *
 * Configuration file format: opencode.json
 * Location: Project root or ~/.config/opencode/opencode.json
 */
export class OpencodeMcp extends ToolMcp {
  private readonly mcpConfig: McpConfig | undefined;

  constructor(params: OpencodeMcpParams) {
    super(params);
    this.mcpConfig = params.config;
  }

  getFileName(): string {
    return "opencode.json";
  }

  async generateContent(): Promise<string> {
    const config = this.mcpConfig || this.getDefaultMcpConfig();
    return this.formatMcpConfig(config);
  }

  /**
   * Format MCP configuration for OpenCode.
   * OpenCode uses a specific JSON schema with "mcp" property instead of "mcpServers".
   */
  private formatMcpConfig(config: McpConfig): string {
    const opencodeConfig = {
      $schema: "https://opencode.ai/config.json",
      mcp: this.convertToOpenCodeFormat(config.mcpServers),
    };

    return this.serializeToJson(opencodeConfig, 2);
  }

  /**
   * Convert standard MCP server configuration to OpenCode format.
   */
  private convertToOpenCodeFormat(servers: Record<string, McpServerBase>): Record<string, unknown> {
    const converted: Record<string, unknown> = {};

    for (const [serverName, server] of Object.entries(servers)) {
      const serverConfig: Record<string, unknown> = {};

      if (server.command) {
        // Local STDIO server configuration
        serverConfig.type = "local";
        serverConfig.command = this.formatCommand(server.command, server.args);
        serverConfig.enabled = server.disabled === undefined ? true : !server.disabled;

        if (server.cwd) {
          serverConfig.cwd = server.cwd;
        }

        if (server.env && Object.keys(server.env).length > 0) {
          serverConfig.environment = this.formatEnvironmentVariables(server.env);
        }
      } else if (server.url) {
        // Remote server configuration
        serverConfig.type = "remote";
        serverConfig.url = server.url;
        serverConfig.enabled = server.disabled === undefined ? true : !server.disabled;

        if (server.env && Object.keys(server.env).length > 0) {
          serverConfig.headers = this.formatHeaders(server.env);
        }
      }

      converted[serverName] = serverConfig;
    }

    return converted;
  }

  /**
   * Get default MCP configuration for OpenCode.
   */
  private getDefaultMcpConfig(): McpConfig {
    return {
      mcpServers: {
        "filesystem-tools": {
          command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
          disabled: false,
        },
        "github-integration": {
          command: ["npx", "-y", "@modelcontextprotocol/server-github"],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
          },
          disabled: false,
        },
      },
    };
  }

  /**
   * Format command and arguments for OpenCode configuration.
   * OpenCode expects command as an array of strings.
   */
  private formatCommand(command: string | string[], args?: string[]): string[] {
    const baseCommand = Array.isArray(command) ? command : [command];
    if (args && args.length > 0) {
      return [...baseCommand, ...args];
    }
    return baseCommand;
  }

  /**
   * Format environment variables for OpenCode.
   * Converts ${env:VAR} format to ${VAR} format expected by OpenCode.
   */
  private formatEnvironmentVariables(env: Record<string, string>): Record<string, string> {
    const formatted: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      // Convert ${env:VAR} to ${VAR} format for OpenCode
      formatted[key] = value.replace(/\$\{env:([^}]+)\}/g, "${$1}");
    }

    return formatted;
  }

  /**
   * Format headers for remote servers.
   * For OpenCode remote servers, authentication and other variables go in headers.
   */
  private formatHeaders(env: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {};
    const formattedEnv = this.formatEnvironmentVariables(env);
    let authHeaderSet = false;

    for (const [key, value] of Object.entries(formattedEnv)) {
      if (this.isAuthenticationVariable(key) && !authHeaderSet) {
        // Format as Authorization header for the first auth variable found
        headers.Authorization = `Bearer ${value}`;
        authHeaderSet = true;
      } else {
        // Include as custom header
        headers[`X-${key.replace(/_/g, "-")}`] = value;
      }
    }

    return headers;
  }

  /**
   * Check if an environment variable represents authentication data.
   */
  private isAuthenticationVariable(key: string): boolean {
    const authPatterns = ["TOKEN", "API_KEY", "KEY", "AUTH"];
    return authPatterns.some((pattern) => key.toUpperCase().includes(pattern));
  }

  /**
   * Load an OpenCode MCP configuration from a file path.
   */
  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<OpencodeMcp> {
    const fileContent = await readFile(filePath, "utf-8");
    const rawConfig = await this.loadJsonConfig(filePath);

    let config: McpConfig | undefined;

    // Validate and convert OpenCode format to standard MCP format
    if (
      this.isValidOpenCodeConfig(rawConfig) &&
      typeof rawConfig === "object" &&
      rawConfig !== null &&
      "mcp" in rawConfig &&
      typeof rawConfig.mcp === "object" &&
      rawConfig.mcp !== null
    ) {
      config = {
        mcpServers: this.convertFromOpenCodeFormat(rawConfig.mcp as Record<string, unknown>),
      };
    }

    const params: OpencodeMcpParams = {
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
    };

    if (config) {
      params.config = config;
    }

    return new OpencodeMcp(params);
  }

  /**
   * Check if the raw configuration is a valid OpenCode MCP format.
   */
  private static isValidOpenCodeConfig(rawConfig: unknown): boolean {
    return (
      typeof rawConfig === "object" &&
      rawConfig !== null &&
      "$schema" in rawConfig &&
      "mcp" in rawConfig &&
      typeof rawConfig.$schema === "string" &&
      typeof rawConfig.mcp === "object" &&
      rawConfig.mcp !== null
    );
  }

  /**
   * Convert OpenCode format back to standard MCP format.
   */
  private static convertFromOpenCodeFormat(
    opencodeMcp: Record<string, unknown>,
  ): Record<string, McpServerBase> {
    const servers: Record<string, McpServerBase> = {};

    for (const [serverName, serverConfig] of Object.entries(opencodeMcp)) {
      if (typeof serverConfig !== "object" || serverConfig === null) {
        continue;
      }

      const config = serverConfig as Record<string, unknown>;
      const server: McpServerBase = {};

      if (typeof config.command === "string" || Array.isArray(config.command)) {
        server.command = config.command;
      }

      if (Array.isArray(config.args)) {
        const argsArray = config.args as unknown[];
        if (argsArray.every((arg: unknown) => typeof arg === "string")) {
          server.args = argsArray as string[];
        }
      }

      if (typeof config.url === "string") {
        server.url = config.url;
      }

      if (typeof config.cwd === "string") {
        server.cwd = config.cwd;
      }

      if (typeof config.environment === "object" && config.environment !== null) {
        const environment = config.environment;
        if (this.isStringRecord(environment)) {
          server.env = environment;
        }
      }

      if (typeof config.headers === "object" && config.headers !== null) {
        const headers = config.headers;
        if (this.isStringRecord(headers)) {
          server.env = headers;
        }
      }

      if (typeof config.enabled === "boolean") {
        server.disabled = !config.enabled;
      }

      servers[serverName] = server;
    }

    return servers;
  }

  /**
   * Type guard to check if an object is a Record<string, string>.
   */
  private static isStringRecord(obj: unknown): obj is Record<string, string> {
    if (typeof obj !== "object" || obj === null) {
      return false;
    }

    return Object.values(obj).every((value) => typeof value === "string");
  }
}
