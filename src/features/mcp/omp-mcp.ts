import { join } from "node:path";

import { OMP_DIR, OMP_GLOBAL_DIR, OMP_MCP_FILE_NAME } from "../../constants/omp-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  resolveLocalMcpCommand,
  resolveRemoteMcpUrl,
  warnAndSkipMcpServer,
} from "./mcp-transport.js";
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
 * Canonical keys consumed by the conversion below (or with no oh-my-pi
 * counterpart), which therefore are not copied verbatim.
 */
const CONSUMED_CANONICAL_KEYS = new Set([
  "type",
  "transport",
  "url",
  "httpUrl",
  "command",
  "args",
  "disabled",
  "enabledTools",
  "disabledTools",
]);

function parseOmpMcpConfig({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse oh-my-pi MCP config at ${relativePath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse oh-my-pi MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

/**
 * Convert the canonical server map to oh-my-pi's `mcpServers` shape. oh-my-pi
 * reads `type` (`stdio` / `http` / `sse`) only, spawns a stdio server from a
 * string `command` plus `args`, and switches a server off with
 * `enabled: false`. A server it cannot start or reach — no transport, a remote
 * transport without a URL, a WebSocket server, or a stdio entry without a
 * command — is skipped with a warning.
 */
function convertToOmpFormat(
  mcpServers: McpServers,
  logger?: Logger,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    if (declaresNoTransport(serverConfig)) {
      warnAndSkipMcpServer({ toolName: "oh-my-pi", serverName, reason: "no transport", logger });
      continue;
    }

    const converted: Record<string, unknown> = {};
    if (isRemoteMcpServer(serverConfig)) {
      const url = resolveRemoteMcpUrl(serverConfig);
      const stated = serverConfig.type ?? serverConfig.transport;
      if (!url) {
        warnAndSkipMcpServer({
          toolName: "oh-my-pi",
          serverName,
          reason: "a remote transport without a url",
          logger,
        });
        continue;
      }
      if (stated === "ws") {
        warnAndSkipMcpServer({
          toolName: "oh-my-pi",
          serverName,
          reason: "a WebSocket transport, which oh-my-pi does not support",
          logger,
        });
        continue;
      }
      converted.type = stated === "sse" ? "sse" : "http";
      converted.url = url;
    } else {
      const [command, ...args] = resolveLocalMcpCommand(serverConfig);
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "oh-my-pi",
          serverName,
          reason: "a stdio transport without a command",
          logger,
        });
        continue;
      }
      converted.type = "stdio";
      converted.command = command;
      if (args.length > 0) {
        converted.args = args;
      }
    }

    for (const [key, value] of Object.entries(serverConfig)) {
      if (CONSUMED_CANONICAL_KEYS.has(key) || PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      converted[key] = value;
    }
    if (serverConfig.disabled === true) {
      converted.enabled = false;
    }

    result[serverName] = converted;
  }

  return result;
}

/**
 * Convert oh-my-pi's `mcpServers` back to the canonical shape: `enabled: false`
 * becomes `disabled: true`; every other key is already canonical.
 */
function convertFromOmpFormat(mcpServers: McpServers): McpServers {
  const result: McpServers = {};
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;
    const { enabled, ...rest } = serverConfig as Record<string, unknown>;
    result[serverName] = enabled === false ? { ...rest, disabled: true } : rest;
  }
  return result;
}

/**
 * MCP generator for oh-my-pi (`omp`). Servers go to the `mcpServers` map of
 * `.omp/mcp.json` (project) or `~/.omp/agent/mcp.json` (global, default
 * profile). Other top-level keys of an existing file (`$schema`,
 * `disabledServers`, ...) are preserved. oh-my-pi expands `${VAR}` and
 * `${VAR:-default}` itself, the same syntax rulesync uses, so values are
 * written unchanged.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/mcp-config.md
 */
export class OmpMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent !== undefined
        ? parseOmpMcpConfig({
            fileContent: this.fileContent,
            relativePath: join(this.relativeDirPath, this.relativeFilePath),
          })
        : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // The global file is shared with servers added through `omp mcp` / `/mcp`.
    return !this.global;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: global ? OMP_GLOBAL_DIR : OMP_DIR,
      relativeFilePath: OMP_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<OmpMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';

    return new OmpMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<OmpMcp> {
    const paths = this.getSettablePaths({ global });
    const relativePath = join(paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readFileContentOrNull(join(outputRoot, relativePath));
    const existing = existingContent
      ? parseOmpMcpConfig({ fileContent: existingContent, relativePath })
      : {};

    const ompConfig = {
      ...existing,
      mcpServers: convertToOmpFormat(rulesyncMcp.getMcpServers(), logger),
    };

    return new OmpMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(ompConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertFromOmpFormat(mcpServers) }, null, 2),
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
  }: ToolMcpForDeletionParams): OmpMcp {
    return new OmpMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
