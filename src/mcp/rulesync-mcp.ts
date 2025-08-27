import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcpConfigSchema, type RulesyncMcpServer } from "../types/mcp.js";
import { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";

/**
 * Schema for MCP server configuration in frontmatter
 */
export const RulesyncMcpServerFrontmatterSchema = z.object({
  targets: z.optional(RulesyncTargetsSchema),
  command: z.optional(z.union([z.string(), z.array(z.string())])),
  args: z.optional(z.array(z.string())),
  url: z.optional(z.string()),
  httpUrl: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  disabled: z.optional(z.boolean()),
  networkTimeout: z.optional(z.number()),
  timeout: z.optional(z.number()),
  trust: z.optional(z.boolean()),
  cwd: z.optional(z.string()),
  transport: z.optional(z.enum(["stdio", "sse", "http"])),
  type: z.optional(z.enum(["sse", "streamable-http"])),
  alwaysAllow: z.optional(z.array(z.string())),
  tools: z.optional(z.array(z.string())),
  headers: z.optional(z.record(z.string(), z.string())),
});

/**
 * Schema for the complete MCP frontmatter
 */
export const RulesyncMcpFrontmatterSchema = z.object({
  targets: z.optional(RulesyncTargetsSchema),
  name: z.string(),
  description: z.string(),
  servers: z.record(z.string(), RulesyncMcpServerFrontmatterSchema),
});

export type RulesyncMcpServerFrontmatter = z.infer<typeof RulesyncMcpServerFrontmatterSchema>;
export type RulesyncMcpFrontmatter = z.infer<typeof RulesyncMcpFrontmatterSchema>;

export interface RulesyncMcpParams extends RulesyncFileParams {
  frontmatter: RulesyncMcpFrontmatter;
}

/**
 * RulesyncMcp class represents an MCP configuration file in the rulesync format.
 * It extends RulesyncFile to handle MCP server configurations with frontmatter metadata.
 */
export class RulesyncMcp extends RulesyncFile {
  private readonly frontmatter: RulesyncMcpFrontmatter;

  constructor({ frontmatter, ...rest }: RulesyncMcpParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate !== false) {
      const result = RulesyncMcpFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
  }

  getFrontmatter(): RulesyncMcpFrontmatter {
    return this.frontmatter;
  }

  /**
   * Convert the MCP configuration to the standard format used by the MCP system
   */
  toMcpConfig(): { mcpServers: Record<string, RulesyncMcpServer> } {
    const mcpServers: Record<string, RulesyncMcpServer> = {};

    for (const [serverName, serverConfig] of Object.entries(this.frontmatter.servers)) {
      // Copy all server configuration except targets (which is rulesync-specific)
      const { targets, ...standardConfig } = serverConfig;

      // Add targets back if present (for rulesync-aware tools)
      if (targets) {
        mcpServers[serverName] = { ...standardConfig, targets };
      } else {
        mcpServers[serverName] = standardConfig;
      }
    }

    return { mcpServers };
  }

  /**
   * Get the server names defined in this MCP configuration
   */
  getServerNames(): string[] {
    return Object.keys(this.frontmatter.servers);
  }

  /**
   * Get a specific server configuration by name
   */
  getServer(name: string): RulesyncMcpServerFrontmatter | undefined {
    return this.frontmatter.servers[name];
  }

  /**
   * Check if a server should be included for a specific tool target
   */
  shouldIncludeServerForTarget(serverName: string, toolTarget: string): boolean {
    const server = this.frontmatter.servers[serverName];
    if (!server) return false;

    // If server has no targets, include it for all tools
    if (!server.targets || server.targets.length === 0) return true;

    // Check if targets include "*" (all tools)
    // Type guard for wildcard target
    if (server.targets.length === 1 && server.targets[0] === "*") return true;

    // Check if the specific tool is in the targets
    // At this point, we know it's not a wildcard target, so it must be a regular ToolTarget array
    return server.targets.some((target) => target === toolTarget);
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncMcpFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      // Additional validation: ensure at least one server is defined
      if (Object.keys(this.frontmatter.servers).length === 0) {
        return {
          success: false,
          error: new Error("At least one MCP server must be defined"),
        };
      }

      // Validate each server has either command or url/httpUrl
      for (const [serverName, serverConfig] of Object.entries(this.frontmatter.servers)) {
        if (!serverConfig.command && !serverConfig.url && !serverConfig.httpUrl) {
          return {
            success: false,
            error: new Error(
              `Server "${serverName}" must have either 'command' for local servers or 'url'/'httpUrl' for remote servers`,
            ),
          };
        }
      }

      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Load an MCP configuration from a markdown file with frontmatter
   */
  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncMcp> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");

    let frontmatter: RulesyncMcpFrontmatter;
    let body: string;

    // Check if the file is JSON (for backward compatibility with .mcp.json files)
    if (filePath.endsWith(".json")) {
      // Parse as JSON and convert to frontmatter format
      const jsonContent = JSON.parse(fileContent);

      // Validate using the MCP config schema first
      const mcpConfigResult = RulesyncMcpConfigSchema.safeParse(jsonContent);
      if (!mcpConfigResult.success) {
        throw new Error(
          `Invalid MCP configuration in ${filePath}: ${mcpConfigResult.error.message}`,
        );
      }

      // Convert to frontmatter format
      frontmatter = {
        name: basename(filePath, ".json"),
        description: "MCP configuration imported from JSON",
        servers: mcpConfigResult.data.mcpServers || {},
      };
      body = "";
    } else {
      // Parse as markdown with frontmatter
      const { data, content } = matter(fileContent);

      // Validate frontmatter using RulesyncMcpFrontmatterSchema
      const result = RulesyncMcpFrontmatterSchema.safeParse(data);
      if (!result.success) {
        throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
      }

      frontmatter = result.data;
      body = content.trim();
    }

    const filename = basename(filePath);

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: ".rulesync/mcp",
      relativeFilePath: filename,
      frontmatter,
      body,
      fileContent,
    });
  }

  /**
   * Create an MCP configuration from a standard MCP config object
   */
  static fromMcpConfig(
    config: { mcpServers: Record<string, RulesyncMcpServer> },
    name: string = "MCP Configuration",
    description: string = "Model Context Protocol server configuration",
  ): RulesyncMcp {
    const frontmatter: RulesyncMcpFrontmatter = {
      name,
      description,
      servers: config.mcpServers || {},
    };

    const body = "";
    const fileContent = matter.stringify(body, frontmatter);

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: ".rulesync/mcp",
      relativeFilePath: "config.md",
      frontmatter,
      body,
      fileContent,
    });
  }
}
