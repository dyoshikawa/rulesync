import { readFile } from "node:fs/promises";
import type { AiFileFromFilePathParams, AiFileParams } from "../types/ai-file.js";
import type { McpServerBase } from "../types/mcp.js";
import { ToolMcp } from "./tool-mcp.js";

interface TestMcpServer extends McpServerBase {
  name: string;
}

export interface OpencodeMcpConfig extends Record<string, unknown> {
  $schema: string;
  mcp: Record<string, unknown>;
}

export interface OpencodeMcpParams extends AiFileParams {
  config?: OpencodeMcpConfig;
}

/**
 * OpenCode MCP configuration generator.
 *
 * Generates MCP configuration files for OpenCode AI coding agent.
 * Supports both local STDIO servers and remote HTTP/SSE servers.
 *
 * Configuration file format: opencode.json
 * Location: Project root
 */
export class OpencodeMcp extends ToolMcp {
  readonly toolName = "OpenCode";
  private readonly config: OpencodeMcpConfig | undefined;
  mcpServers: McpServerBase[] = [];

  constructor({ config, ...rest }: OpencodeMcpParams) {
    super(rest);
    this.config = config;
  }

  getFileName(): string {
    return "opencode.json";
  }

  async generateContent(): Promise<string> {
    // Use config if provided, otherwise generate from mcpServers
    const finalConfig = this.config ?? (await this.generateConfig(this.mcpServers));
    return this.serializeToJson(finalConfig, 2);
  }

  /**
   * Generate OpenCode MCP configuration from MCP servers.
   *
   * OpenCode supports:
   * - Local servers (STDIO transport) with type: "local"
   * - Remote servers (SSE/HTTP transport) with type: "remote"
   * - Environment variable substitution using ${VAR} format
   *
   * @param servers Array of MCP server configurations
   * @returns OpenCode-compatible configuration object
   */
  private async generateConfig(servers: McpServerBase[]): Promise<OpencodeMcpConfig> {
    const config: OpencodeMcpConfig = {
      $schema: "https://opencode.ai/config.json",
      mcp: {},
    };

    const mcpConfig = config.mcp;

    // Convert from array to object format expected by MCP processing
    const serverMap: Record<string, McpServerBase> = {};
    for (const server of servers) {
      // Use server name from a name property or generate one
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      const testServer = server as TestMcpServer & McpServerBase;
      const serverName = testServer.name || `server-${Object.keys(serverMap).length}`;
      serverMap[serverName] = server;
    }

    for (const [serverName, server] of Object.entries(serverMap)) {
      const serverConfig: Record<string, unknown> = {};

      if (server.command) {
        // Local STDIO server configuration
        serverConfig.type = "local";
        serverConfig.command = this.formatCommand(server.command, server.args);
        serverConfig.enabled = true;

        if (server.cwd) {
          serverConfig.cwd = server.cwd;
        }

        if (server.env && Object.keys(server.env).length > 0) {
          serverConfig.environment = this.formatEnvironmentVariables(server.env);
        }
      } else if (server.url) {
        // Remote server configuration (SSE/HTTP)
        serverConfig.type = "remote";
        serverConfig.url = server.url;
        serverConfig.enabled = true;

        if (server.env && Object.keys(server.env).length > 0) {
          serverConfig.headers = this.formatHeaders(server.env);
        }
      }

      mcpConfig[serverName] = serverConfig;
    }

    return config;
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
    // Read and parse JSON content
    const rawConfig = await this.loadJsonConfig(filePath);

    // Validate the structure of the raw config
    if (
      typeof rawConfig === "object" &&
      rawConfig !== null &&
      "$schema" in rawConfig &&
      "mcp" in rawConfig &&
      typeof rawConfig.$schema === "string" &&
      typeof rawConfig.mcp === "object" &&
      rawConfig.mcp !== null
    ) {
      const config: OpencodeMcpConfig = {
        $schema: rawConfig.$schema,
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        mcp: rawConfig.mcp as Record<string, unknown>,
      };
      const fileContent = await readFile(filePath, "utf-8");

      return new OpencodeMcp({
        baseDir,
        relativeDirPath,
        relativeFilePath,
        fileContent,
        config,
        validate,
      });
    }

    throw new Error(
      `Invalid OpenCode MCP configuration in ${filePath}: missing required properties`,
    );
  }
}
