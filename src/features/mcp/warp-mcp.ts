import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
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
 * MCP generator for Warp.
 *
 * Warp reads file-based MCP configuration from:
 * - Project scope: `.warp/.mcp.json`
 * - Global scope: `~/.warp/.mcp.json`
 *
 * Both scopes use the same relative path under `.warp`; only the
 * `outputRoot` (project directory vs. home directory) differs.
 */
export class WarpMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent !== undefined
        ? WarpMcp.parseJsonOrThrow(this.fileContent, this.relativeDirPath, this.relativeFilePath)
        : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  private static parseJsonOrThrow(
    content: string,
    relativeDirPath: string,
    relativeFilePath: string,
  ): Record<string, unknown> {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to parse Warp MCP config at ${join(relativeDirPath, relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".warp",
      relativeFilePath: ".mcp.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<WarpMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = this.parseJsonOrThrow(fileContent, paths.relativeDirPath, paths.relativeFilePath);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new WarpMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<WarpMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = this.parseJsonOrThrow(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    const warpConfig = { ...json, mcpServers: rulesyncMcp.getMcpServers() };

    return new WarpMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(warpConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers ?? {} }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): WarpMcp {
    return new WarpMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
