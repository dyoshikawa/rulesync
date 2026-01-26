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

const CURSOR_ENV_VAR_PATTERN = /\$\{env:([^}]+)\}/g;

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
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".cursor",
      relativeFilePath: "mcp.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<CursorMcp> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new CursorMcp({
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
  }: ToolMcpFromRulesyncMcpParams): CursorMcp {
    const json = rulesyncMcp.getJson();

    // Convert Rulesync MCP format to Cursor MCP format
    const mcpServers = (json.mcpServers || {}) as McpServers;
    const transformedServers = convertEnvToCursorFormat(mcpServers);

    const cursorConfig = {
      mcpServers: transformedServers,
    };

    const fileContent = JSON.stringify(cursorConfig, null, 2);

    return new CursorMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = (this.json.mcpServers || {}) as McpServers;
    const transformedServers = convertEnvFromCursorFormat(mcpServers);

    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: "rulesync.mcp.json",
      fileContent: JSON.stringify({ mcpServers: transformedServers }, null, 2),
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
  }: ToolMcpForDeletionParams): CursorMcp {
    return new CursorMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
