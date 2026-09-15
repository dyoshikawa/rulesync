import { join } from "node:path";

import { z } from "zod/mini";

import { POOL_GLOBAL_DIR } from "../../constants/pool-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import {
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

const PoolServerSchema = z.looseObject({
  command: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
  cwd: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  disabled: z.optional(z.boolean()),
  enabled_tools: z.optional(z.array(z.string())),
  allow: z.optional(z.array(z.string())),
  deny: z.optional(z.array(z.string())),
  transport: z.optional(
    z.looseObject({
      type: z.enum(["http", "sse"]),
      url: z.string(),
      headers: z.optional(z.array(z.string())),
    }),
  ),
});

function parsePoolConfig(fileContent: string): Record<string, unknown> {
  return parseSharedConfig({ format: "yaml", fileContent, invalidRootPolicy: "error" });
}

function toPoolServers({
  servers,
  logger,
}: {
  servers: McpServers;
  logger?: Logger;
}): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    const converted: Record<string, unknown> = {};
    if (isRemoteMcpServer(server)) {
      const url = resolveRemoteMcpUrl(server);
      const type = server.type ?? server.transport;
      if (!url || type === "ws" || /^wss?:/i.test(url)) {
        warnAndSkipMcpServer({
          toolName: "Pool",
          serverName: name,
          reason: "an unsupported or incomplete remote transport",
          logger,
        });
        continue;
      }
      converted.transport = {
        type: type === "sse" ? "sse" : "http",
        url,
        ...(server.headers !== undefined && {
          headers: Object.entries(server.headers).map(([key, value]) => `${key}: ${value}`),
        }),
      };
    } else {
      const [command, ...args] = resolveLocalMcpCommand(server);
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "Pool",
          serverName: name,
          reason: "a local transport without a command",
          logger,
        });
        continue;
      }
      converted.command = command;
      converted.args = args;
      if (server.cwd !== undefined) converted.cwd = server.cwd;
    }
    if (server.env !== undefined) converted.env = server.env;
    if (server.disabled !== undefined) converted.disabled = server.disabled;
    if (server.enabledTools !== undefined) converted.enabled_tools = server.enabledTools;
    if (server.disabledTools !== undefined) converted.deny = server.disabledTools;
    // Pool's glob allowlist is distinct from its exact enabled_tools list.
    if (server.allow !== undefined) converted.allow = server.allow;
    result[name] = PoolServerSchema.parse(converted);
  }
  return result;
}

function fromPoolServers(config: Record<string, unknown>): McpServers {
  const native = z.record(z.string(), PoolServerSchema).parse(config.mcp_servers ?? {});
  const result: McpServers = {};
  for (const [name, server] of Object.entries(native)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    const converted: McpServers[string] = {};
    if (server.transport) {
      converted.type = server.transport.type;
      converted.url = server.transport.url;
      if (server.transport.headers !== undefined) {
        const entries: [string, string][] = [];
        const seen = new Set<string>();
        for (const header of server.transport.headers) {
          const separator = header.indexOf(":");
          const key = header.slice(0, separator).trim();
          if (separator <= 0 || !key || seen.has(key.toLowerCase())) {
            throw new Error("Pool MCP headers must have unique names followed by a colon");
          }
          seen.add(key.toLowerCase());
          entries.push([key, header.slice(separator + 1).trim()]);
        }
        converted.headers = Object.fromEntries(entries);
      }
    } else {
      converted.command = server.command;
      converted.args = server.args;
      converted.cwd = server.cwd;
    }
    if (server.env !== undefined) converted.env = server.env;
    if (server.disabled !== undefined) converted.disabled = server.disabled;
    if (server.enabled_tools !== undefined) converted.enabledTools = server.enabled_tools;
    if (server.deny !== undefined) converted.disabledTools = server.deny;
    if (server.allow !== undefined) converted.allow = server.allow;
    result[name] = converted;
  }
  return result;
}

/** Pool MCP settings share a YAML file with permissions, hooks and model settings.
 * @see https://docs.poolside.ai/mcp-servers
 */
export class PoolMcp extends ToolMcp {
  constructor(params: ToolMcpParams) {
    super(params);
    parsePoolConfig(this.fileContent ?? "");
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: global ? POOL_GLOBAL_DIR : ".poolside",
      relativeFilePath: "settings.yaml",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    global = false,
    validate = true,
  }: ToolMcpFromFileParams): Promise<PoolMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? "";
    return new PoolMcp({ outputRoot, global, validate, ...paths, fileContent });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    global = false,
    validate = true,
    rulesyncMcp,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<PoolMcp> {
    const paths = this.getSettablePaths({ global });
    const existingContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? "";
    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "mcp",
      existingContent,
      patch: { mcp_servers: toPoolServers({ servers: rulesyncMcp.getMcpServers(), logger }) },
      logger,
    });
    return new PoolMcp({ outputRoot, global, validate, ...paths, fileContent });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({
        mcpServers: fromPoolServers(parsePoolConfig(this.fileContent)),
      }),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion(params: ToolMcpForDeletionParams): PoolMcp {
    return new PoolMcp({ ...params, fileContent: "", validate: false });
  }
}
