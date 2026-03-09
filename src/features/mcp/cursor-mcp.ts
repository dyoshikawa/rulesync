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

const CURSOR_ENV_VAR_PATTERN = /\$\{env:([^}]+)\}/g;

/**
 * Type guard to check if a value is a valid McpServers object
 */
function isMcpServers(value: unknown): value is McpServers {
  return value !== undefined && value !== null && typeof value === "object";
}

/**
 * Convert Cursor env format to canonical format
 * - ${env:VAR} -> ${VAR}
 */
function convertEnvFromCursorFormat(mcpServers: McpServers): McpServers {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        ...config,
        ...(config.env && {
          env: Object.fromEntries(
            Object.entries(config.env).map(([k, v]) => [
              k,
              v.replace(CURSOR_ENV_VAR_PATTERN, "${$1}"),
            ]),
          ),
        }),
      },
    ]),
  );
}

/**
 * Convert canonical env format to Cursor format
 * - ${VAR} -> ${env:VAR} (avoids double-converting)
 */
function convertEnvToCursorFormat(mcpServers: McpServers): McpServers {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        ...config,
        ...(config.env && {
          env: Object.fromEntries(
            Object.entries(config.env).map(([k, v]) => [
              k,
              v.replace(/\$\{(?!env:)([^}:]+)\}/g, "${env:$1}"),
            ]),
          ),
        }),
      },
    ]),
  );
}

export type CursorMcpParams = ToolMcpParams;

export class CursorMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      try {
        this.json = JSON.parse(this.fileContent);
      } catch (error) {
        throw new Error(
          `Failed to parse Cursor MCP config at ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(error)}`,
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
      relativeDirPath: ".cursor",
      relativeFilePath: "mcp.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CursorMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Cursor MCP config at ${join(paths.relativeDirPath, paths.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new CursorMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CursorMcp> {
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
        `Failed to parse Cursor MCP config at ${join(paths.relativeDirPath, paths.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const rulesyncJson = rulesyncMcp.getJson();
    const mcpServers = isMcpServers(rulesyncJson.mcpServers) ? rulesyncJson.mcpServers : {};
    const transformedServers = convertEnvToCursorFormat(mcpServers);

    const cursorConfig = { ...json, mcpServers: transformedServers };

    return new CursorMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(cursorConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    const transformedServers = convertEnvFromCursorFormat(mcpServers);

    const transformedJson = {
      ...this.json,
      mcpServers: transformedServers,
    };

    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: "rulesync.mcp.json",
      fileContent: JSON.stringify(transformedJson),
      validate: true,
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
  }: ToolMcpForDeletionParams): CursorMcp {
    return new CursorMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
