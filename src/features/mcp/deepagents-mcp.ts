import { join } from "node:path";

import { DEEPAGENTS_DIR, DEEPAGENTS_MCP_FILE_NAME } from "../../constants/deepagents-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import type { McpServers } from "../../types/mcp.js";
import {
  getDeepagentsRelativeDirPath,
  getDeepagentsRulesyncOutputRoot,
} from "../../utils/deepagents.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  isRemoteMcpServer,
  resolveLocalMcpCommand,
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

const TOOL_NAME = "deepagents";

/**
 * Map a canonical transport onto the three dcode accepts.
 *
 * `_resolve_server_type` takes `stdio`, `sse` and `http`, plus the aliases
 * `streamable_http` / `streamable-http` → `http`. Rulesync's canonical
 * vocabulary is wider: `local` and `ws` are spellings dcode rejects outright,
 * and a rejected server is dropped at load time with only a log line. `local`
 * has an exact equivalent so it is translated; `ws` has none and is skipped at
 * generate time instead, where the warning can still reach the author.
 *
 * @see https://docs.langchain.com/oss/deepagents/code/mcp-tools
 */
function normalizeDeepagentsTransport(transport: unknown): "stdio" | "http" | "sse" | undefined {
  switch (transport) {
    case "local":
    case "stdio":
      return "stdio";
    case "streamable-http":
    case "streamable_http":
    case "http":
      return "http";
    case "sse":
      return "sse";
    default:
      // Absent or unrecognized: dcode infers the transport from `url`, so the
      // key is left off rather than guessed at.
      return undefined;
  }
}

/**
 * Rewrite an array `command` in place on `converted`, or return `false` (after
 * warning) when the server has to be skipped.
 *
 * FastMCP 4's `StdioMCPServer.command` is a single string, so an array command
 * fails validation and dcode drops the server. The array's head is the
 * executable and its tail goes in front of `args`.
 */
function applyDeepagentsCommand({
  name,
  server,
  converted,
  logger,
}: {
  name: string;
  server: McpServers[string];
  converted: Record<string, unknown>;
  logger?: Logger;
}): boolean {
  if (!Array.isArray(server.command)) {
    return true;
  }
  const [command, ...args] = resolveLocalMcpCommand(server);
  if (command === undefined) {
    if (isRemoteMcpServer(server)) {
      // A remote server has no use for a command; an empty one is dropped so
      // dcode does not reject the server for declaring both.
      delete converted.command;
      return true;
    }
    warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName: name,
      reason: "an empty command list, which leaves deepagents nothing to spawn",
      logger,
    });
    return false;
  }
  converted.command = command;
  if (args.length > 0) {
    converted.args = args;
  } else {
    delete converted.args;
  }
  return true;
}

/**
 * Translate one canonical server into dcode's `.mcp.json` shape, or `null` to
 * skip it.
 *
 * Two upstream constraints from `_validate_tool_filter_fields` are enforced
 * here, because breaking either one makes dcode drop the whole server: the two
 * filters are mutually exclusive on a single server, and neither may be an
 * empty list.
 */
function toDeepagentsServer({
  name,
  server,
  logger,
}: {
  name: string;
  server: McpServers[string];
  logger?: Logger;
}): Record<string, unknown> | null {
  // dcode reads no per-server `disabled` key — its only off switch is the
  // server viewer's `[mcp].disabled_servers` list in `config.toml` — and
  // FastMCP ignores unknown keys, so writing `disabled: true` would leave the
  // server running. Leaving it out is the only form "disabled" has here.
  if (server.disabled === true) {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName: name,
      reason:
        "disabled: true, which deepagents does not read from .mcp.json (the server would still run)",
      logger,
    });
  }

  const rawTransport = server.transport ?? server.type;
  if (rawTransport === "ws") {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName: name,
      reason: "the WebSocket transport, which deepagents does not support",
      logger,
    });
  }

  const {
    enabledTools,
    disabledTools,
    type: _type,
    transport,
    disabled: _disabled,
    httpUrl,
    ...rest
  } = server;
  const converted: Record<string, unknown> = { ...rest };

  if (!applyDeepagentsCommand({ name, server, converted, logger })) {
    return null;
  }

  // dcode resolves a remote server from `url` alone and never reads the
  // `httpUrl` alias, so an `httpUrl`-only entry would be taken for stdio and
  // rejected for its missing `command`. `url` wins when both are set.
  const pinsStreamableHttp = server.url === undefined && httpUrl !== undefined;
  if (pinsStreamableHttp) {
    converted.url = httpUrl;
  }

  const normalized =
    normalizeDeepagentsTransport(rawTransport) ??
    // `httpUrl` names a streamable HTTP endpoint specifically, so the transport
    // is pinned rather than left for FastMCP to infer from the URL's path.
    (pinsStreamableHttp ? "http" : undefined);
  if (normalized !== undefined) {
    // The canonical key is preserved: a server authored with `transport` keeps
    // using it, and dcode reads either one.
    if (transport !== undefined) {
      converted.transport = normalized;
    } else {
      converted.type = normalized;
    }
  }

  // Upstream reads `allowedTools`, never `enabledTools`, and ignores unknown
  // keys silently — so forwarding the canonical name verbatim would be a no-op.
  //
  // `_validate_tool_filter_fields` raises on a server that sets both filters and
  // on an empty list, and dcode drops a server it cannot validate. Each case is
  // resolved the way that does not hand the model more tools than the canonical
  // config allows:
  if (enabledTools !== undefined && disabledTools !== undefined) {
    // Both set is valid canonically (other targets apply the two lists
    // independently) but has no form here, and upstream refuses it outright.
    // Writing neither would leave the server running with every tool, denied
    // ones included, so the server is skipped like the `ws` case above.
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName: name,
      reason: "both enabledTools and disabledTools, which deepagents rejects — pick one",
      logger,
    });
  }

  if (enabledTools !== undefined) {
    if (enabledTools.length === 0) {
      // An allowlist of nothing means no tools at all. Dropping the key would
      // publish every tool instead, so the server is skipped — which is also
      // what an empty allowlist asks for.
      return warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName: name,
        reason:
          "an empty enabledTools list, which allows no tools at all and which deepagents rejects",
        logger,
      });
    }
    converted.allowedTools = enabledTools;
  } else if (disabledTools !== undefined) {
    if (disabledTools.length === 0) {
      // A denylist of nothing is genuinely a no-op, so only the key is dropped —
      // skipping the server here would remove tools the config never denied.
      logger?.warn(
        `${TOOL_NAME} MCP: dropping the empty disabledTools list on "${name}"; it denies nothing, ` +
          `and deepagents rejects the empty form.`,
      );
    } else {
      converted.disabledTools = disabledTools;
    }
  }

  return converted;
}

/** Lift dcode's spellings back into the canonical model. */
function toRulesyncServer(server: Record<string, unknown>): Record<string, unknown> {
  const { allowedTools, ...rest } = server;
  const converted: Record<string, unknown> = { ...rest };

  for (const key of ["type", "transport"] as const) {
    if (converted[key] === "streamable_http" || converted[key] === "streamable-http") {
      converted[key] = "http";
    }
  }

  if (Array.isArray(allowedTools)) {
    converted.enabledTools = allowedTools;
  }

  return converted;
}

export class DeepagentsMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    // `.deepagents/.mcp.json` in both scopes; `DEEPAGENTS_HOME`, when set, is
    // the global directory itself.
    return {
      relativeDirPath: getDeepagentsRelativeDirPath({ global, relativeDirPath: DEEPAGENTS_DIR }),
      relativeFilePath: DEEPAGENTS_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<DeepagentsMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new DeepagentsMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<DeepagentsMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = JSON.parse(fileContent);

    const mcpServers: Record<string, unknown> = {};
    for (const [name, server] of Object.entries(rulesyncMcp.getMcpServers())) {
      const converted = toDeepagentsServer({ name, server, logger });
      if (converted !== null) {
        mcpServers[name] = converted;
      }
    }

    const mcpJson = { ...json, mcpServers };

    return new DeepagentsMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mcpJson, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = isRecord(this.json.mcpServers) ? this.json.mcpServers : {};
    const mcpServers = Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [
        name,
        isRecord(server) ? toRulesyncServer(server) : server,
      ]),
    );

    return this.toRulesyncMcpDefault({
      outputRoot: getDeepagentsRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
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
  }: ToolMcpForDeletionParams): DeepagentsMcp {
    return new DeepagentsMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
