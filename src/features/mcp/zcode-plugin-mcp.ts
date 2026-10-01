import { join } from "node:path";

import { ZCODE_PLUGIN_MCP_FILE_NAME } from "../../constants/plugin-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import type { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  type ToolMcpForDeletionParams,
  type ToolMcpFromFileParams,
  type ToolMcpFromRulesyncMcpParams,
  type ToolMcpParams,
  type ToolMcpSettablePaths,
} from "./tool-mcp.js";
import { convertFromZcodeFormat, convertToZcodeFormat } from "./zcode-mcp.js";

/** A plugin's on/off switch, spelled `enabled` (`.zcode/config.json` says `enable`). */
const ZCODE_PLUGIN_ENABLE_KEY = "enabled";

/**
 * The server map of a plugin `.mcp.json`: ZCode reads either `{ "mcpServers": {...} }`
 * or a bare server map.
 */
function serversOf(json: Record<string, unknown>): Record<string, unknown> {
  if (json.mcpServers === undefined) return json;
  return isRecord(json.mcpServers) ? json.mcpServers : {};
}

/**
 * MCP servers inside a ZCode plugin bundle (`<plugin>/.mcp.json`, under
 * `mcpServers`). Servers are written in ZCode's native shape — stdio
 * `command`/`args`/`env`, remote `type` (`http` or `sse`)/`url`/`headers` —
 * and a canonical `disabled: true` becomes the plugin loader's
 * `enabled: false`. The bundle is generated in full by rulesync, so the file
 * is written whole and may be deleted.
 *
 * @see https://zcode.z.ai/en/docs/plugin
 */
export class ZcodePluginMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    const filePath = join(this.relativeDirPath, this.relativeFilePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fileContent || "{}");
    } catch (error) {
      throw new Error(
        `Failed to parse ZCode plugin MCP config in ${filePath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    if (!isRecord(parsed)) {
      throw new Error(
        `Failed to parse ZCode plugin MCP config in ${filePath}: expected a JSON object`,
      );
    }
    this.json = parsed;
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return { relativeDirPath: ".", relativeFilePath: ZCODE_PLUGIN_MCP_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<ZcodePluginMcp> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    return new ZcodePluginMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}',
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<ZcodePluginMcp> {
    const paths = this.getSettablePaths();
    const mcpServers = convertToZcodeFormat({
      mcpServers: rulesyncMcp.getMcpServers(),
      logger,
      enableKey: ZCODE_PLUGIN_ENABLE_KEY,
    });
    return new ZcodePluginMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ mcpServers }, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromZcodeFormat({
      zcodeServers: serversOf(this.json),
      enableKey: ZCODE_PLUGIN_ENABLE_KEY,
    });
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): ZcodePluginMcp {
    return new ZcodePluginMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      validate: false,
    });
  }
}
