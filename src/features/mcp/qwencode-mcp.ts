import { join } from "node:path";

import { QWENCODE_DIR, QWENCODE_SETTINGS_FILE_NAME } from "../../constants/qwencode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
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
 * Map rulesync's canonical per-server tool filters to Qwen Code's field names.
 * Qwen uses `includeTools` (allowlist) / `excludeTools` (denylist) while
 * rulesync uses `enabledTools` / `disabledTools`.
 * https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md
 */
function convertToQwencodeFormat(mcpServers: McpServers): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const newServer: Record<string, unknown> = { ...serverConfig };
      if ("enabledTools" in newServer) {
        newServer.includeTools = newServer.enabledTools;
        delete newServer.enabledTools;
      }
      if ("disabledTools" in newServer) {
        newServer.excludeTools = newServer.disabledTools;
        delete newServer.disabledTools;
      }
      return [serverName, newServer];
    }),
  );
}

/**
 * Map Qwen Code's per-server tool filters back to rulesync's canonical names.
 */
function convertFromQwencodeFormat(mcpServers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const newServer: Record<string, unknown> = {
        ...(serverConfig as Record<string, unknown>),
      };
      if ("includeTools" in newServer) {
        newServer.enabledTools = newServer.includeTools;
        delete newServer.includeTools;
      }
      if ("excludeTools" in newServer) {
        newServer.disabledTools = newServer.excludeTools;
        delete newServer.excludeTools;
      }
      return [serverName, newServer];
    }),
  );
}

export class QwencodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: QWENCODE_DIR,
        relativeFilePath: QWENCODE_SETTINGS_FILE_NAME,
      };
    }
    return {
      relativeDirPath: QWENCODE_DIR,
      relativeFilePath: QWENCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<QwencodeMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new QwencodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<QwencodeMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);
    // Use getMcpServers() (not getJson()) so rulesync-only fields and
    // codex-only fields (`envVars`) are stripped before writing the
    // qwen settings file. Then map enabledTools/disabledTools to Qwen's
    // includeTools/excludeTools.
    const newJson = {
      ...json,
      mcpServers: convertToQwencodeFormat(rulesyncMcp.getMcpServers()),
    };

    return new QwencodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromQwencodeFormat(
      (this.json.mcpServers as Record<string, unknown>) ?? {},
    );
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  /**
   * settings.json may contain other settings, so it should not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): QwencodeMcp {
    return new QwencodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
