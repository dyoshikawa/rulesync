import { join } from "node:path";

import {
  CODEIUM_WINDSURF_DIR,
  DEVIN_MCP_FILE_NAME,
  WINDSURF_DIR,
} from "../../constants/devin-paths.js";
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
 * MCP generator for Devin (Cascade).
 *
 * Devin reads file-based MCP configuration from:
 * - Project scope: `.windsurf/mcp_config.json`
 * - Global scope: `~/.codeium/windsurf/mcp_config.json`
 *
 * The official docs document only the global path; the project path mirrors
 * the same `mcp_config.json` filename so both scopes fit the processor
 * framework cleanly. The top-level key is `mcpServers`; each server is a
 * stdio entry ({ command, args, env }) or a remote entry
 * ({ serverUrl | url, headers }), and may carry an optional `disabledTools`
 * array.
 */
export type DevinMcpParams = ToolMcpParams;

export class DevinMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent !== undefined
        ? DevinMcp.parseJsonOrThrow(this.fileContent, this.relativeDirPath, this.relativeFilePath)
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
        `Failed to parse Devin MCP config at ${join(relativeDirPath, relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Devin MCP uses different directories for project and global modes:
    // - Project mode: .windsurf/mcp_config.json
    // - Global mode: .codeium/windsurf/mcp_config.json (under the home dir)
    if (global) {
      return {
        relativeDirPath: CODEIUM_WINDSURF_DIR,
        relativeFilePath: DEVIN_MCP_FILE_NAME,
      };
    }
    return {
      relativeDirPath: WINDSURF_DIR,
      relativeFilePath: DEVIN_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<DevinMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = this.parseJsonOrThrow(fileContent, paths.relativeDirPath, paths.relativeFilePath);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new DevinMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<DevinMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = this.parseJsonOrThrow(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    // Use getMcpServers() (not getJson()) so rulesync-only fields and
    // codex-only fields (`envVars`) are stripped before writing the
    // devin config.
    const devinConfig = { ...json, mcpServers: rulesyncMcp.getMcpServers() };

    return new DevinMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(devinConfig, null, 2),
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
  }: ToolMcpForDeletionParams): DevinMcp {
    return new DevinMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
