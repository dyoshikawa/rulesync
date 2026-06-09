import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import {
  convertEnvVarRefsFromToolFormat,
  convertEnvVarRefsToToolFormat,
} from "./mcp-env-var-format.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

// Variable names exclude `:` (matching the canonical and OpenCode patterns);
// environment variable names cannot contain `:` on any supported OS.
const CURSOR_ENV_VAR_PATTERN = /\$\{env:([^}:]+)\}/g;

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
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CursorMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CursorMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
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

    // Use getMcpServers() (not getJson()) so rulesync-only fields and
    // codex-only fields (`envVars`) are stripped before writing the
    // cursor config.
    const mcpServers = rulesyncMcp.getMcpServers();
    const transformedServers = convertEnvVarRefsToToolFormat({
      mcpServers,
      replacement: "${env:$1}",
    });

    const cursorConfig = { ...json, mcpServers: transformedServers };

    return new CursorMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(cursorConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    const transformedServers = convertEnvVarRefsFromToolFormat({
      mcpServers,
      pattern: CURSOR_ENV_VAR_PATTERN,
    });

    const transformedJson = {
      ...this.json,
      mcpServers: transformedServers,
    };

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(transformedJson, null, 2),
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
  }: ToolMcpForDeletionParams): CursorMcp {
    return new CursorMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
