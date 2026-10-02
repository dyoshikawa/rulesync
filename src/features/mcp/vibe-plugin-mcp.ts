import { join } from "node:path";

import { VIBE_PLUGIN_MCP_FILE_NAME } from "../../constants/plugin-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { McpServer, McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
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

/** The `$schema` Vibe requires verbatim on a plugin's `mcp.json`. */
export const VIBE_PLUGIN_MCP_SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

/** Variables Vibe sets on every plugin stdio server; `env` may not define them. */
const VIBE_PLUGIN_RESERVED_ENV: ReadonlySet<string> = new Set(["PLUGIN_ROOT", "PLUGIN_DATA"]);

/**
 * Canonical keys the Agent Plugins server shapes have a slot for. Each shape
 * is `extra="forbid"`, so any other key would make Vibe reject the server.
 */
const STDIO_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "transport",
  "command",
  "args",
  "env",
  "cwd",
]);
const REMOTE_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "transport",
  "url",
  "httpUrl",
  "headers",
]);

type VibePluginMcpServer =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | { type: "streamable-http"; url: string; headers?: Record<string, string> };

function transportOf(server: McpServer): string | undefined {
  const transport = server.transport ?? server.type;
  if (transport === "local") return "stdio";
  if (transport !== undefined) return transport;
  if (server.command !== undefined) return "stdio";
  if (server.url !== undefined || server.httpUrl !== undefined) return "streamable-http";
  return undefined;
}

function warnDroppedFields({
  name,
  server,
  supported,
  logger,
}: {
  name: string;
  server: McpServer;
  supported: ReadonlySet<string>;
  logger?: Logger;
}): void {
  const dropped = Object.keys(server).filter(
    (key) => !supported.has(key) && server[key] !== undefined,
  );
  if (dropped.length > 0) {
    logger?.warn(
      `vibe-plugin MCP server "${name}": dropping ${dropped.join(", ")}, ` +
        `which Vibe's plugin mcp.json does not accept.`,
    );
  }
}

function toStdioServer({
  name,
  server,
  logger,
}: {
  name: string;
  server: McpServer;
  logger?: Logger;
}): VibePluginMcpServer | undefined {
  const commandParts = Array.isArray(server.command)
    ? server.command
    : server.command === undefined
      ? []
      : [server.command];
  const [command, ...commandArgs] = commandParts;
  if (command === undefined || command === "") {
    logger?.warn(`Skipping vibe-plugin MCP server "${name}": a stdio server needs a command.`);
    return undefined;
  }
  // Vibe resolves `./` against the plugin root and refuses any other path.
  if (!command.startsWith("./") && /[\\/]/.test(command)) {
    logger?.warn(
      `vibe-plugin MCP server "${name}": Vibe accepts only a bare executable or a ` +
        `"./"-relative path inside the plugin as the command, so ${JSON.stringify(command)} ` +
        `will be rejected.`,
    );
  }
  if (
    server.cwd !== undefined &&
    !server.cwd.startsWith("./") &&
    !/^\$\{PLUGIN_(?:ROOT|DATA)\}(?:\/|$)/.test(server.cwd)
  ) {
    logger?.warn(
      `vibe-plugin MCP server "${name}": Vibe requires cwd to start with "./", ` +
        `"\${PLUGIN_ROOT}" or "\${PLUGIN_DATA}", so ${JSON.stringify(server.cwd)} will be rejected.`,
    );
  }
  const env = Object.fromEntries(
    Object.entries(server.env ?? {}).filter(([key]) => {
      if (!VIBE_PLUGIN_RESERVED_ENV.has(key)) return true;
      logger?.warn(
        `vibe-plugin MCP server "${name}": dropping env ${key}, which Vibe reserves for plugin servers.`,
      );
      return false;
    }),
  );
  const args = [...commandArgs, ...(server.args ?? [])];
  return {
    type: "stdio",
    command,
    ...(args.length > 0 && { args }),
    ...(Object.keys(env).length > 0 && { env }),
    ...(server.cwd !== undefined && { cwd: server.cwd }),
  };
}

/**
 * Convert canonical servers to the Agent Plugins 1.0 `mcpServers` map Vibe
 * reads from a plugin: stdio and streamable-http only. Vibe parses SSE and
 * WebSocket servers but never starts them, and has no per-server disable flag,
 * so such servers are skipped with a warning.
 */
function toVibePluginServers({
  mcpServers,
  logger,
}: {
  mcpServers: McpServers;
  logger?: Logger;
}): Record<string, VibePluginMcpServer> {
  const result: Record<string, VibePluginMcpServer> = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    if (isPrototypePollutionKey(name)) {
      logger?.warn(`Skipping vibe-plugin MCP server "${name}": the name is reserved.`);
      continue;
    }
    if (server.disabled === true) {
      logger?.warn(
        `Skipping disabled vibe-plugin MCP server "${name}": Vibe's plugin mcp.json has no ` +
          `per-server disable flag.`,
      );
      continue;
    }
    const transport = transportOf(server);
    if (transport === "stdio") {
      warnDroppedFields({
        name,
        server: { ...server, disabled: undefined },
        supported: STDIO_FIELDS,
        logger,
      });
      const converted = toStdioServer({ name, server, logger });
      if (converted) result[name] = converted;
      continue;
    }
    if (transport === "http" || transport === "streamable-http") {
      const url = server.url ?? server.httpUrl;
      if (url === undefined) {
        logger?.warn(`Skipping vibe-plugin MCP server "${name}": a remote server needs a url.`);
        continue;
      }
      warnDroppedFields({
        name,
        server: { ...server, disabled: undefined },
        supported: REMOTE_FIELDS,
        logger,
      });
      result[name] = {
        type: "streamable-http",
        url,
        ...(server.headers !== undefined && { headers: server.headers }),
      };
      continue;
    }
    logger?.warn(
      `Skipping vibe-plugin MCP server "${name}": Vibe runs only stdio and streamable-http ` +
        `servers from a plugin` +
        (transport === undefined ? "." : `, not ${JSON.stringify(transport)}.`),
    );
  }
  return result;
}

function fromVibePluginServers(servers: Record<string, unknown>): McpServers {
  const result: McpServers = {};
  for (const [name, raw] of Object.entries(servers)) {
    if (isPrototypePollutionKey(name) || !isRecord(raw)) continue;
    const { type, ...rest } = raw;
    if (type === "stdio") {
      result[name] = { ...rest };
      continue;
    }
    if (type === "streamable-http" || type === "sse") {
      result[name] = { type: type === "sse" ? "sse" : "http", ...rest };
    }
  }
  return result;
}

/**
 * MCP servers inside a Vibe plugin bundle (`<plugin>/mcp.json`), in the
 * Agent Plugins 1.0 shape: a `$schema` plus `mcpServers`, each server
 * discriminated by `type`. The bundle is generated in full by rulesync, so the
 * file is written whole and may be deleted.
 *
 * @see https://github.com/mistralai/mistral-vibe/blob/v2.25.8/vibe/core/plugins/_native.py
 */
export class VibePluginMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    const filePath = join(this.relativeDirPath, this.relativeFilePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fileContent || "{}");
    } catch (error) {
      throw new Error(
        `Failed to parse Vibe plugin MCP config in ${filePath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    if (!isRecord(parsed)) {
      throw new Error(
        `Failed to parse Vibe plugin MCP config in ${filePath}: expected a JSON object`,
      );
    }
    this.json = parsed;
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return { relativeDirPath: ".", relativeFilePath: VIBE_PLUGIN_MCP_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<VibePluginMcp> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    return new VibePluginMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<VibePluginMcp> {
    const paths = this.getSettablePaths();
    const mcpServers = toVibePluginServers({ mcpServers: rulesyncMcp.getMcpServers(), logger });
    return new VibePluginMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ $schema: VIBE_PLUGIN_MCP_SCHEMA_URL, mcpServers }, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = isRecord(this.json.mcpServers) ? this.json.mcpServers : {};
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: fromVibePluginServers(servers) }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): VibePluginMcp {
    return new VibePluginMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      validate: false,
    });
  }
}
