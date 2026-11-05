import { join } from "node:path";

import { WARP_DIR, WARP_MCP_FILE_NAME } from "../../constants/warp-paths.js";
import { isMcpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { parseMcpJsonOrThrow } from "./mcp-json-config.js";
import { McpServerConfig } from "./mcp-transport.js";
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

/**
 * Warp spells the canonical `cwd` as `working_directory` ("Working directory
 * path where the command is run, used for resolving relative paths" —
 * https://docs.warp.dev/agent-platform/capabilities/mcp/). A tool-native
 * `working_directory` already on the server wins over `cwd`, which is then
 * dropped rather than written as a key Warp does not read.
 */
function convertServerToWarpFormat(server: McpServerConfig): McpServerConfig {
  if (typeof server.cwd !== "string") {
    return server;
  }
  const { cwd, ...rest } = server;
  return { working_directory: cwd, ...rest };
}

/** The inverse: `working_directory` back to the canonical `cwd`. */
function convertServerFromWarpFormat(server: McpServerConfig): McpServerConfig {
  const { working_directory, ...rest } = server;
  if (typeof working_directory !== "string") {
    return server;
  }
  return { ...rest, cwd: working_directory };
}
export class WarpMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent !== undefined
        ? parseMcpJsonOrThrow({
            fileContent: this.fileContent,
            relativePath: join(this.relativeDirPath, this.relativeFilePath),
            label: "Warp",
          })
        : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: WARP_DIR,
      relativeFilePath: WARP_MCP_FILE_NAME,
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
    const json = parseMcpJsonOrThrow({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
      label: "Warp",
    });
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new this({
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

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = parseMcpJsonOrThrow({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
      label: "Warp",
    });

    const mcpServers = Object.fromEntries(
      Object.entries(rulesyncMcp.getMcpServers()).map(([name, server]) => [
        name,
        convertServerToWarpFormat(server),
      ]),
    );
    const warpConfig = { ...json, mcpServers };

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(warpConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const raw = this.json.mcpServers;
    const mcpServers = isMcpServers(raw)
      ? Object.fromEntries(
          Object.entries(raw).map(([name, server]) => [name, convertServerFromWarpFormat(server)]),
        )
      : {};
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): WarpMcp {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
