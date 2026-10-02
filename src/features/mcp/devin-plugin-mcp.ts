import { join } from "node:path";

import { DEVIN_PLUGIN_MCP_FILE_NAME } from "../../constants/plugin-paths.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { DevinMcp } from "./devin-mcp.js";
import type {
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

/**
 * MCP servers inside a Devin plugin bundle (`<plugin>/.mcp.json`, under
 * `mcpServers`). Servers keep the same shape as `.devin/mcp_config.json`.
 * Unlike the project file, there is no legacy `config.json` fallback and no
 * personal `*.local.json` overlay: the bundle is generated in full by
 * rulesync, so the file is written whole and may be deleted.
 *
 * @see https://docs.devin.ai/cli/extensibility/plugins/overview
 */
export class DevinPluginMcp extends DevinMcp {
  static override getSettablePaths(): ToolMcpSettablePaths {
    return { relativeDirPath: ".", relativeFilePath: DEVIN_PLUGIN_MCP_FILE_NAME };
  }

  static override async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<DevinPluginMcp> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    let json: unknown;
    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Devin plugin MCP config at ${filePath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const mcpServers = isRecord(json) && isRecord(json.mcpServers) ? json.mcpServers : {};
    return new DevinPluginMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ mcpServers }, null, 2),
      validate,
    });
  }

  static override async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): Promise<DevinPluginMcp> {
    const paths = this.getSettablePaths();
    return new DevinPluginMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ mcpServers: rulesyncMcp.getMcpServers() }, null, 2),
      validate,
    });
  }
}
