import { join } from "node:path";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

// Roo Code uses "streamable-http" instead of "http" for HTTP-based MCP servers
// Since "streamable-http" is not part of the standard MCP type schema,
// we use Record<string, unknown> as the intermediate type for Roo-specific format

type RooMcpServers = Record<string, Record<string, unknown>>;

/**
 * Type guard to check if a value is a valid RooMcpServers object
 */
function isRooMcpServers(value: unknown): value is RooMcpServers {
  return value !== undefined && value !== null && typeof value === "object";
}

/**
 * Convert Rulesync MCP format to Roo MCP format
 * - type: "http" -> "streamable-http"
 * - transport: "http" -> "streamable-http"
 */
function convertToRooFormat(mcpServers: McpServers): RooMcpServers {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const converted: Record<string, unknown> = { ...serverConfig };
      if (serverConfig.type === "http") {
        converted.type = "streamable-http";
      }
      if (serverConfig.transport === "http") {
        converted.transport = "streamable-http";
      }
      return [serverName, converted];
    }),
  );
}

/**
 * Convert Roo MCP format to Rulesync MCP format
 * - type: "streamable-http" -> "http"
 * - transport: "streamable-http" -> "http"
 */
function convertFromRooFormat(mcpServers: RooMcpServers): McpServers {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const converted: Record<string, unknown> = { ...serverConfig };
      if (serverConfig.type === "streamable-http") {
        converted.type = "http";
      }
      if (serverConfig.transport === "streamable-http") {
        converted.transport = "http";
      }
      return [serverName, converted];
    }),
  );
}

export class RooMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".roo",
      relativeFilePath: "mcp.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<RooMcp> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );
    return new RooMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): RooMcp {
    const mcpServers = rulesyncMcp.getMcpServers();
    const convertedMcpServers = convertToRooFormat(mcpServers);
    const fileContent = JSON.stringify({ mcpServers: convertedMcpServers }, null, 2);

    return new RooMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const rawMcpServers: RooMcpServers = isRooMcpServers(this.json.mcpServers)
      ? this.json.mcpServers
      : {};
    const convertedMcpServers = convertFromRooFormat(rawMcpServers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertedMcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): RooMcp {
    return new RooMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
