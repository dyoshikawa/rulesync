import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

/**
 * Type guard to check if a value is a valid McpServers object
 */
function isMcpServers(value: unknown): value is McpServers {
  return value !== undefined && value !== null && typeof value === "object";
}

/**
 * Rovodev MCP: global only at ~/.rovodev/mcp.json.
 * Same shape as Cursor: { mcpServers: { ... } }. See Rovodev MCP docs.
 * Project-level MCP is not supported; use --global when generating.
 */
export type RovodevMcpParams = ToolMcpParams;

export class RovodevMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      try {
        this.json = JSON.parse(this.fileContent);
      } catch (error) {
        throw new Error(
          `Failed to parse Rovodev MCP config at ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(error)}`,
          { cause: error },
        );
      }
    } else {
      this.json = {};
    }
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".rovodev",
      relativeFilePath: "mcp.json",
    };
  }

  static getToolTargetsGlobal(): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".rovodev",
      relativeFilePath: "mcp.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<RovodevMcp> {
    if (!global) {
      throw new Error("Rovodev MCP is global-only; use --global to sync ~/.rovodev/mcp.json");
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Rovodev MCP config at ${join(paths.relativeDirPath, paths.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new RovodevMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<RovodevMcp> {
    if (!global) {
      throw new Error("Rovodev MCP is global-only; use --global to sync ~/.rovodev/mcp.json");
    }
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Rovodev MCP config at ${join(paths.relativeDirPath, paths.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const rulesyncJson = rulesyncMcp.getJson();
    const mcpServers = isMcpServers(rulesyncJson.mcpServers) ? rulesyncJson.mcpServers : {};

    const rovodevConfig = { ...json, mcpServers };

    return new RovodevMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(rovodevConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    const transformedJson = {
      ...this.json,
      mcpServers,
    };
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(transformedJson, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): RovodevMcp {
    return new RovodevMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
