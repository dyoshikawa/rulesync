import { join } from "node:path";

import {
  COPILOT_DIR,
  COPILOTCLI_MCP_FILE_NAME,
  COPILOTCLI_PROJECT_MCP_FILE_NAME,
  GITHUB_DIR,
} from "../../constants/copilot-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServerSchema, type McpServer, type McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
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
  type ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

type CopilotcliMcpConfig = {
  mcpServers?: Record<string, McpServer & Record<string, unknown>>;
};

type CopilotcliServerType = NonNullable<McpServer["type"]>;

/**
 * Reached over WebSocket, which Copilot CLI has no transport for. The url is
 * read as well as the declared transport: a `wss://` server that names no
 * transport would otherwise be written as `http`, which is the state the
 * declared-`ws` skip exists to avoid.
 */
const isWebSocketServer = (server: McpServer): boolean => {
  if ((server.type ?? server.transport) === "ws") {
    return true;
  }
  // The same resolution the write side uses, so the two cannot disagree about
  // which url is the one going out. Schemes are case-insensitive.
  const url = resolveRemoteMcpUrl(server);
  return url !== undefined && /^wss?:\/\//i.test(url);
};

/**
 * Copilot CLI knows `stdio`, `local`, `http` and `sse`. `streamable-http` is
 * the MCP spec's name for HTTP and resolves to `http` rather than falling
 * through to `stdio`, where it used to be reported as a server missing its
 * command. A server that states no transport is read from what it carries: a
 * command makes it `stdio`, a url makes it `http`.
 */
const resolveCopilotcliServerType = (server: McpServer): CopilotcliServerType => {
  const declared = server.type ?? server.transport;
  switch (declared) {
    case "sse":
      return "sse";
    case "http":
    case "streamable-http":
      return "http";
    case "stdio":
    case "local":
      return declared;
    default:
      break;
  }

  if (server.command !== undefined) {
    return "stdio";
  }
  return isRemoteMcpServer(server) ? "http" : "stdio";
};

/**
 * Copilot CLI's per-server tool allowlist. `tools` selects which of the
 * server's tools are exposed — `["*"]` (the default) for all, or a list of
 * names — so the canonical `enabledTools` is written under that name rather
 * than passed through as a key the CLI ignores.
 *
 * When a server carries both, the canonical `enabledTools` wins and the native
 * `tools` is dropped with a warning. rulesync owns the generated allowlist, and
 * the `tools` value most likely present is the upstream default `["*"]` — left
 * to win, it would silently discard a real allowlist in favour of "expose every
 * tool", which is the failure this mapping exists to prevent.
 *
 * `disabledTools` has no counterpart upstream (expressing it would need the
 * server's full tool list), so the target keeps `supportsDisabledTools: false`
 * and the processor strips it before it reaches here.
 *
 * @see https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
 */
function renameEnabledToolsToTools({
  server,
  serverName,
  logger,
}: {
  server: McpServer;
  serverName: string;
  logger?: Logger;
}): Record<string, unknown> {
  const { enabledTools, ...rest } = server;
  if (enabledTools === undefined) {
    return rest;
  }
  if (rest.tools !== undefined) {
    logger?.warn(
      `[CopilotcliMcp] MCP server "${serverName}" declares both 'tools' and 'enabledTools'; keeping 'enabledTools' and dropping 'tools'.`,
    );
  }
  return { ...rest, tools: enabledTools };
}

/**
 * Copilot CLI's `tools` accepts more than the canonical `enabledTools` shape:
 * `--tools` documents `*`, a comma-separated list, or `""`, so a hand-written or
 * CLI-written entry can be a bare string. Canonical `enabledTools` is
 * `string[]`, and `RulesyncMcp` throws on a schema failure — carrying a string
 * through would reject the WHOLE imported MCP file rather than one key. Anything
 * that is not a string array is therefore left under `tools` untouched, matching
 * `codexcli-mcp.ts`'s `isValidRenamedArray` guard on the same class of rename.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Resolves and sets the transport type for each MCP server config.
 * GitHub Copilot CLI requires the "type" field for each server. A server it
 * cannot express — one that names no transport, or names one it carries no way
 * to reach — is skipped with a warning: every entry in `mcp-config.json`
 * defines a server, and throwing would abort the whole generate run, every
 * target and feature of it, over a single entry.
 */
function addTypeField(mcpServers: McpServers, logger?: Logger): CopilotcliMcpConfig["mcpServers"] {
  const result: NonNullable<CopilotcliMcpConfig["mcpServers"]> = {};

  for (const [name, server] of Object.entries(mcpServers)) {
    const parsed = McpServerSchema.parse(server);
    // The shape a Kilo `{"enabled": …}` toggle imports as, which switches off a
    // server some other config layer defines. Copilot CLI has no equivalent.
    if (declaresNoTransport(parsed)) {
      warnAndSkipMcpServer({
        toolName: "GitHub Copilot CLI",
        serverName: name,
        reason: "no transport at all",
        logger,
      });
      continue;
    }

    // Writing it as `http` would leave a `wss://` url under a transport
    // Copilot CLI speaks HTTP to, so it is skipped the way the Kimi Code
    // adapter skips one over the same missing transport.
    if (isWebSocketServer(parsed)) {
      warnAndSkipMcpServer({
        toolName: "GitHub Copilot CLI",
        serverName: name,
        reason: "a WebSocket transport, which it does not support",
        logger,
      });
      continue;
    }

    const type = resolveCopilotcliServerType(parsed);

    if (type === "http" || type === "sse") {
      const url = resolveRemoteMcpUrl(parsed);
      if (url === undefined) {
        warnAndSkipMcpServer({
          toolName: "GitHub Copilot CLI",
          serverName: name,
          reason: "a remote transport but no url",
          logger,
        });
        continue;
      }

      // `httpUrl` is a canonical-only alias; Copilot CLI reads `url`, so the
      // resolved value is written there and the alias does not go out.
      const { httpUrl: _httpUrl, ...rest } = parsed;
      result[name] = {
        ...renameEnabledToolsToTools({ server: rest, serverName: name, logger }),
        type,
        url,
      };
      continue;
    }

    // `httpUrl` is a canonical-only alias and does not go out on this branch
    // either, even though a local server has no business carrying one.
    const { httpUrl: _localHttpUrl, ...local } = parsed;
    const command = resolveLocalMcpCommand(parsed);
    const [head, ...tail] = command;
    if (head === undefined) {
      warnAndSkipMcpServer({
        toolName: "GitHub Copilot CLI",
        serverName: name,
        reason: "a local transport but no command",
        logger,
      });
      continue;
    }

    result[name] = {
      ...renameEnabledToolsToTools({ server: local, serverName: name, logger }),
      type,
      command: head,
      ...(tail.length > 0 && { args: tail }),
    };
  }

  return result;
}

/**
 * Removes the "type" field when converting back to rulesync format.
 */
function removeTypeField(config: CopilotcliMcpConfig): McpServers {
  const result: McpServers = {};

  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    // `tools` is Copilot CLI's spelling of the canonical `enabledTools`; it is
    // read back so a hand-written allowlist survives an import round-trip. A
    // value the canonical schema cannot hold (e.g. the documented bare `"*"`)
    // stays under `tools` rather than failing validation of the whole file.
    const { tools, ...withoutTools } = server;
    const restored = (
      isStringArray(tools)
        ? { ...withoutTools, enabledTools: tools }
        : { ...withoutTools, ...(tools !== undefined && { tools }) }
    ) as McpServers[string];

    if (restored.type !== "stdio") {
      result[name] = restored;
      continue;
    }

    const { type: _, ...rest } = restored;
    result[name] = rest;
  }

  return result;
}

export class CopilotcliMcp extends ToolMcp {
  private readonly json: CopilotcliMcpConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): CopilotcliMcpConfig {
    return this.json;
  }

  /**
   * In global mode, ~/.copilot/mcp-config.json should not be deleted
   * as it may contain other user settings.
   * In project mode, .github/mcp.json is a rulesync-managed workspace MCP file
   * and can be safely deleted.
   */
  override isDeletable(): boolean {
    return !this.global;
  }

  /**
   * - **Project scope**: `<project>/.github/mcp.json` — the Copilot CLI
   *   auto-loads MCP servers from this workspace config file. It uses the
   *   standard `{ "mcpServers": {...} }` shape.
   *   https://github.com/github/copilot-cli (changelog v1.0.61, 2026-06-09)
   * - **Global scope**: `~/.copilot/mcp-config.json` — the personal/global
   *   Copilot CLI MCP configuration.
   */
  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: COPILOT_DIR,
        relativeFilePath: COPILOTCLI_MCP_FILE_NAME,
      };
    }
    return {
      relativeDirPath: GITHUB_DIR,
      relativeFilePath: COPILOTCLI_PROJECT_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CopilotcliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new CopilotcliMcp({
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
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<CopilotcliMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = JSON.parse(fileContent);

    // Convert rulesync format to Copilot CLI format (add "type": "stdio")
    const copilotCliMcpServers = addTypeField(rulesyncMcp.getMcpServers(), logger);
    const mcpJson = { ...json, mcpServers: copilotCliMcpServers };

    return new CopilotcliMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mcpJson, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    // Convert Copilot CLI format back to rulesync format (remove "type" field)
    const mcpServers = removeTypeField(this.json);
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
  }: ToolMcpForDeletionParams): CopilotcliMcp {
    return new CopilotcliMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
