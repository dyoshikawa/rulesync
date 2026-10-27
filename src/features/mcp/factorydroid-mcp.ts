import { join } from "node:path";

import {
  FACTORYDROID_DIR,
  FACTORYDROID_MCP_FILE_NAME,
} from "../../constants/factorydroid-paths.js";
import type { McpServers } from "../../types/mcp.js";
import { readFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { warnAndSkipMcpServer } from "./mcp-transport.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const TOOL_NAME = "factorydroid";

/**
 * Drop servers whose `enabledTools` allowlist is empty.
 *
 * Canonically an empty allowlist allows no tools, but Droid applies
 * `enabledTools` only "when the list is non-empty"
 * (https://docs.factory.com/harness/mcp), so writing `[]` would load every
 * tool the server reports. Skipping the server is the only form that does not
 * hand the model more tools than the canonical config allows.
 */
function skipEmptyAllowlistServers({
  mcpServers,
  logger,
}: {
  mcpServers: McpServers;
  logger?: Logger;
}): McpServers {
  const kept: McpServers = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    if (server.enabledTools?.length === 0) {
      warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName: name,
        reason:
          "an empty enabledTools list, which allows no tools at all but which Factory Droid treats as no filter",
        logger,
      });
      continue;
    }
    kept[name] = server;
  }
  return kept;
}

export class FactorydroidMcp extends ToolMcp {
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
      relativeDirPath: FACTORYDROID_DIR,
      relativeFilePath: FACTORYDROID_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<FactorydroidMcp> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new FactorydroidMcp({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    logger,
  }: ToolMcpFromRulesyncMcpParams): FactorydroidMcp {
    // Use getMcpServers() (not getJson()) so rulesync-only fields and
    // codex-only fields (`envVars`) are stripped before writing the
    // Factory Droid config.
    const mcpServers = skipEmptyAllowlistServers({
      mcpServers: rulesyncMcp.getMcpServers(),
      logger,
    });

    // Factory Droid uses standard MCP format without transformations
    const factorydroidConfig = {
      mcpServers,
    };

    const fileContent = JSON.stringify(factorydroidConfig, null, 2);

    return new FactorydroidMcp({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault();
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): FactorydroidMcp {
    return new FactorydroidMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
