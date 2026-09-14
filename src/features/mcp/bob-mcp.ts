import { join } from "node:path";

import { BOB_DIR, BOB_GLOBAL_MCP_FILE_NAME, BOB_MCP_FILE_NAME } from "../../constants/bob-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isRemoteMcpServer, resolveRemoteMcpUrl } from "./mcp-transport.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

type BobMcpServers = Record<string, Record<string, unknown>>;

/**
 * Convert the canonical server map to Bob's shape. Bob names the transport
 * through the URL field rather than a `type` key: `command` starts a stdio
 * server, `url` reaches an SSE server and `httpURL` a streamable HTTP one. A
 * remote server that states `sse` (via `type` or `transport`) keeps `url`;
 * every other remote server — a bare `url`, `http`, `streamable-http`, or the
 * `httpUrl` alias — is written as `httpURL`, streamable HTTP being the current
 * MCP transport. The canonical `type` / `transport` keys are dropped because
 * Bob has no such key; `args`, `env`, `headers`, `cwd`, `timeout`,
 * `alwaysAllow` and `disabled` pass through unchanged, as Bob documents all of
 * them.
 * @see https://bob.ibm.com/docs/shell/configuration/mcp/mcp-bobshell
 */
function convertToBobFormat(mcpServers: McpServers): BobMcpServers {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const { type, transport, url: _url, httpUrl: _httpUrl, ...rest } = serverConfig;
      const converted: Record<string, unknown> = { ...rest };
      if (isRemoteMcpServer(serverConfig)) {
        const remoteUrl = resolveRemoteMcpUrl(serverConfig);
        if (remoteUrl !== undefined) {
          const isSse = type === "sse" || transport === "sse";
          converted[isSse ? "url" : "httpURL"] = remoteUrl;
        }
      }
      return [serverName, converted];
    }),
  );
}

/**
 * Convert Bob's server map back to the canonical shape. `httpURL` becomes
 * `url` with `type: "http"`; a plain `url` is an SSE server in Bob, so it gains
 * `type: "sse"` to keep that reading on the next generate.
 */
function convertFromBobFormat(mcpServers: unknown): McpServers {
  if (!isMcpServers(mcpServers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const { httpURL, ...rest } = serverConfig as Record<string, unknown>;
      const converted: Record<string, unknown> = { ...rest };
      if (typeof httpURL === "string") {
        converted.url = httpURL;
        converted.type = "http";
      } else if (typeof converted.url === "string") {
        converted.type = "sse";
      }
      return [serverName, converted];
    }),
  );
}

/**
 * IBM Bob MCP configuration.
 *
 * Bob reads `mcpServers` from `<project>/.bob/mcp.json` (project scope) and
 * `~/.bob/mcp_settings.json` (user scope); the project entry wins when both
 * define the same server name. Both files are dedicated to MCP, so the
 * project one is deletable, while the user one is left in place because Bob
 * creates it itself.
 *
 * @see https://bob.ibm.com/docs/shell/configuration/mcp/mcp-bobshell
 */
export class BobMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      try {
        this.json = JSON.parse(this.fileContent);
      } catch (error) {
        throw new Error(
          `Failed to parse Bob MCP config at ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(error)}`,
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: BOB_DIR,
      relativeFilePath: global ? BOB_GLOBAL_MCP_FILE_NAME : BOB_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<BobMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Bob MCP config at ${join(paths.relativeDirPath, paths.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new BobMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<BobMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    // Keep any top-level sibling keys of an existing file; only `mcpServers`
    // is regenerated.
    const fileContent =
      (await readFileContentOrNull(filePath)) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Bob MCP config at ${join(paths.relativeDirPath, paths.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }

    // Use getMcpServers() (not getJson()) so rulesync-only fields are
    // stripped before writing the Bob config.
    const mcpServers = convertToBobFormat(rulesyncMcp.getMcpServers());
    const bobConfig = { ...json, mcpServers };

    return new BobMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(bobConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromBobFormat(this.json.mcpServers);
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
    global = false,
  }: ToolMcpForDeletionParams): BobMcp {
    return new BobMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
