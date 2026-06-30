import { join } from "node:path";

import {
  DEVIN_CONFIG_FILE_NAME,
  DEVIN_DIR,
  DEVIN_GLOBAL_CONFIG_DIR_PATH,
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
 * MCP generator for Devin Local (native `.devin/` configuration).
 *
 * Devin reads MCP servers from the `mcpServers` key of its native config file:
 * - Project scope: `.devin/config.json`
 * - Global scope: `~/.config/devin/config.json`
 *
 * The config file is shared with the permissions feature (`permissions` key)
 * and, in global mode, the hooks feature (`hooks` key), so reads and writes
 * merge into the existing JSON rather than overwriting it, and the file is
 * never deleted. Each server is a stdio entry ({ command, args, env }) or a
 * remote entry ({ serverUrl | url, headers }), and may carry an optional
 * `disabledTools` array.
 *
 * @see https://docs.devin.ai/cli/extensibility/configuration
 */

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

  /**
   * config.json may carry the permissions/hooks features' keys, so it is never
   * deleted; only the managed `mcpServers` key is rewritten.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Devin Local reads MCP servers from the native config file:
    // - Project mode: .devin/config.json
    // - Global mode: ~/.config/devin/config.json (under the home dir)
    if (global) {
      return {
        relativeDirPath: DEVIN_GLOBAL_CONFIG_DIR_PATH,
        relativeFilePath: DEVIN_CONFIG_FILE_NAME,
      };
    }
    return {
      relativeDirPath: DEVIN_DIR,
      relativeFilePath: DEVIN_CONFIG_FILE_NAME,
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
