import { join } from "node:path";

import {
  ZCODE_CONFIG_FILE_NAME,
  ZCODE_DIR,
  ZCODE_GLOBAL_CONFIG_DIR_PATH,
  ZCODE_MCP_CONFIG_KEY,
  ZCODE_MCP_SERVERS_KEY,
} from "../../constants/zcode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
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
 * Single spelling of the config.json codec/policy, matching the
 * `SHARED_CONFIG_OWNERSHIP` declaration for both scopes: fail closed on an
 * unparseable root rather than replacing the user's primary ZCode config with
 * generated output.
 */
function parseZcodeConfig(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * ZCode's two documented remote transports, spelled the way its config does.
 * `streamable-http` is the canonical rulesync name for what ZCode calls
 * `http`; everything else is left to the caller to reject.
 */
function asZcodeRemoteType(stated: string | undefined, url: string): "http" | "sse" | undefined {
  if (stated === "sse") return "sse";
  if (stated === "http" || stated === "streamable-http") return "http";
  if (stated === undefined) {
    // With no transport stated, a `ws://`/`wss://` URL is not something ZCode
    // can reach; every other URL is HTTP, its default remote transport.
    return /^wss?:\/\//i.test(url) ? undefined : "http";
  }
  return undefined;
}

/**
 * Convert canonical rulesync servers to ZCode's native `mcp.servers` shape:
 * stdio servers carry `command`/`args`/`env`, remote servers carry
 * `type` (`http` or `sse`), `url` and optional `headers`. A canonical
 * `disabled: true` maps to ZCode's `enable: false`, which it defaults to `true`
 * when absent.
 *
 * @see https://zcode.z.ai/en/docs/mcp-services
 */
function convertToZcodeFormat(mcpServers: McpServers, logger?: Logger): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (!isRecord(config)) continue;

    if (declaresNoTransport(config)) {
      warnAndSkipMcpServer({
        toolName: "ZCode",
        serverName: name,
        reason: "no transport",
        logger,
      });
      continue;
    }

    const converted: Record<string, unknown> = {};
    if (isRemoteMcpServer(config)) {
      const url = resolveRemoteMcpUrl(config);
      if (!url) {
        warnAndSkipMcpServer({
          toolName: "ZCode",
          serverName: name,
          reason: "a remote transport without a url",
          logger,
        });
        continue;
      }
      const stated = config.type ?? config.transport;
      const type = asZcodeRemoteType(stated, url);
      if (type === undefined) {
        // Rewriting a `ws` server as `http` would hand ZCode a server it cannot
        // connect to, so it is skipped out loud instead (the rovodev/musecode
        // precedent).
        warnAndSkipMcpServer({
          toolName: "ZCode",
          serverName: name,
          reason: `the "${stated ?? "ws"}" transport, which ZCode does not implement (only stdio, http and sse are supported)`,
          logger,
        });
        continue;
      }
      converted.type = type;
      converted.url = url;
      if (config.headers && Object.keys(config.headers).length > 0) {
        converted.headers = config.headers;
      }
    } else {
      const commandArray = resolveLocalMcpCommand(config);
      const [command, ...args] = commandArray;
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "ZCode",
          serverName: name,
          reason: "a stdio transport without a command",
          logger,
        });
        continue;
      }
      converted.command = command;
      converted.args = args;
      if (config.env && Object.keys(config.env).length > 0) {
        converted.env = config.env;
      }
    }
    if (config.disabled === true) {
      converted.enable = false;
    }

    result[name] = converted;
  }

  return result;
}

/**
 * Convert ZCode's native `mcp.servers` shape back to canonical rulesync
 * servers: `enable: false` maps back to `disabled: true`, and unknown keys pass
 * through untouched so a hand-authored entry survives the round-trip.
 */
function convertFromZcodeFormat(zcodeServers: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(zcodeServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "enable") {
        if (value === false) {
          converted.disabled = true;
        }
        continue;
      }
      converted[key] = value;
    }

    result[name] = converted;
  }

  return result;
}

/**
 * ZCode MCP servers.
 *
 * ZCode reads MCP servers from the `mcp.servers` block of its own config file:
 * `<project>/.zcode/config.json` at workspace scope and `~/.zcode/cli/config.json`
 * at user scope. The legacy `.agents/mcp.json` fallback is consulted only while
 * the `.zcode` file of the same scope lists no server, so rulesync writes the
 * native location and leaves the fallback alone. Sibling keys of `servers`
 * inside `mcp`, and every other top-level config key, are preserved; the file
 * is never deleted.
 *
 * @see https://zcode.z.ai/en/docs/mcp-services
 */
export class ZcodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseZcodeConfig(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // config.json is ZCode's primary config file, so it must never be removed
    // wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: global ? ZCODE_GLOBAL_CONFIG_DIR_PATH : ZCODE_DIR,
      relativeFilePath: ZCODE_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ZcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";

    return new ZcodeMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<ZcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseZcodeConfig(existingContent, filePath);

    const converted = convertToZcodeFormat(rulesyncMcp.getMcpServers(), logger);

    // `mcp` is owned as a whole key, so its non-`servers` siblings (e.g. a
    // `timeout` the user set) are carried over from the existing file before
    // the servers snapshot replaces `servers`.
    const existingMcp = isRecord(existing[ZCODE_MCP_CONFIG_KEY])
      ? existing[ZCODE_MCP_CONFIG_KEY]
      : {};

    return new ZcodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: {
          [ZCODE_MCP_CONFIG_KEY]: { ...existingMcp, [ZCODE_MCP_SERVERS_KEY]: converted },
        },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcp = isRecord(this.json[ZCODE_MCP_CONFIG_KEY]) ? this.json[ZCODE_MCP_CONFIG_KEY] : {};
    const servers = isRecord(mcp[ZCODE_MCP_SERVERS_KEY]) ? mcp[ZCODE_MCP_SERVERS_KEY] : {};
    const converted = convertFromZcodeFormat(servers);

    // Do not spread the full config JSON: ZCode's own keys (model, theme, ...)
    // must not leak into rulesync mcp.json.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: converted }, null, 2),
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
  }: ToolMcpForDeletionParams): ZcodeMcp {
    // The shared config file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new ZcodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(
        { [ZCODE_MCP_CONFIG_KEY]: { [ZCODE_MCP_SERVERS_KEY]: {} } },
        null,
        2,
      ),
      validate: false,
      global,
    });
  }
}
