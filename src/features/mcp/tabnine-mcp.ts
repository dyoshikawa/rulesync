import { join } from "node:path";

import {
  TABNINE_AGENT_DIR_PATH,
  TABNINE_SETTINGS_FILE_NAME,
} from "../../constants/tabnine-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  omitPrototypePollutionKeysDeep,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
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

type TabnineMcpServers = Record<string, Record<string, unknown>>;

/**
 * The remote `type` Tabnine CLI reads a server as. Tabnine documents `"http"`
 * (streamable HTTP, the default for a bare `url`) and `"sse"`; `streamable-http`
 * is the canonical alias for the former. A `ws(s)://` URL or any other stated
 * transport is something Tabnine cannot reach, so `undefined` tells the caller
 * to skip the server. `null` means "omit `type`": Tabnine then tries
 * streamable HTTP first and falls back to SSE on its own.
 * @see https://docs.tabnine.com/main/getting-started/tabnine-agent/mcp-intro-and-setup/mcp-server-config
 */
function asTabnineRemoteType(
  stated: string | undefined,
  url: string,
): "http" | "sse" | null | undefined {
  if (stated === "sse") return "sse";
  if (stated === "http" || stated === "streamable-http") return "http";
  if (stated === undefined) {
    return /^wss?:\/\//i.test(url) ? undefined : null;
  }
  return undefined;
}

/**
 * Convert the canonical server map to the shape Tabnine CLI documents for the
 * `mcpServers` block of `settings.json`: a stdio server carries `command` (plus
 * `args`), a remote one carries `url` and an optional `type` (`"http"` or
 * `"sse"`). The canonical `transport` alias and the Claude-style `httpUrl`
 * alias are folded into `type`/`url`; `enabledTools`/`disabledTools` become
 * Tabnine's `includeTools`/`excludeTools`; `env`, `cwd`, `headers`, `timeout`
 * and `trust` pass through as documented.
 *
 * A server Tabnine cannot start or reach — no transport at all, a remote
 * transport without a URL, a WebSocket URL, or a stdio entry without a command
 * — is skipped with a warning rather than written in a broken form.
 */
function convertToTabnineFormat(mcpServers: McpServers, logger?: Logger): TabnineMcpServers {
  const result: TabnineMcpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    if (declaresNoTransport(serverConfig)) {
      warnAndSkipMcpServer({ toolName: "Tabnine CLI", serverName, reason: "no transport", logger });
      continue;
    }

    const {
      type,
      transport,
      url: _url,
      httpUrl: _httpUrl,
      command: _command,
      args: _args,
      enabledTools,
      disabledTools,
      ...rest
    } = serverConfig;
    const converted: Record<string, unknown> = {};

    if (isRemoteMcpServer(serverConfig)) {
      const url = resolveRemoteMcpUrl(serverConfig);
      if (!url) {
        warnAndSkipMcpServer({
          toolName: "Tabnine CLI",
          serverName,
          reason: "a remote transport without a url",
          logger,
        });
        continue;
      }
      const stated = type ?? transport;
      const remoteType = asTabnineRemoteType(stated, url);
      if (remoteType === undefined) {
        warnAndSkipMcpServer({
          toolName: "Tabnine CLI",
          serverName,
          reason:
            stated === undefined
              ? "a WebSocket url, which Tabnine CLI's remote transports (http and sse) cannot reach"
              : `the "${stated}" transport, which Tabnine CLI does not offer for remote servers (only http and sse)`,
          logger,
        });
        continue;
      }
      converted.url = url;
      if (remoteType !== null) {
        converted.type = remoteType;
      }
    } else {
      const [command, ...args] = resolveLocalMcpCommand(serverConfig);
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "Tabnine CLI",
          serverName,
          reason: "a stdio transport without a command",
          logger,
        });
        continue;
      }
      converted.command = command;
      if (args.length > 0) {
        converted.args = args;
      }
    }

    for (const [key, value] of Object.entries(rest)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      // Every passthrough value is sanitized recursively: `env` and `headers`
      // are key/value maps Tabnine spreads into the server's process environment
      // and HTTP requests, and an undocumented key may nest an object too.
      converted[key] = omitPrototypePollutionKeysDeep(value);
    }
    if (enabledTools !== undefined) {
      converted.includeTools = enabledTools;
    }
    if (disabledTools !== undefined) {
      converted.excludeTools = disabledTools;
    }
    result[serverName] = converted;
  }

  return result;
}

/**
 * Convert Tabnine's server map back to the canonical shape: `includeTools` /
 * `excludeTools` become `enabledTools` / `disabledTools`; `type` (`stdio`,
 * `sse`, `http`) and every other documented field are already canonical and
 * pass through with their prototype-pollution keys dropped at every nesting
 * level, mirroring the generate side.
 */
function convertFromTabnineFormat(mcpServers: unknown): McpServers {
  if (!isMcpServers(mcpServers)) {
    return {};
  }
  const result: McpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(serverConfig)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "includeTools") {
        converted.enabledTools = value;
      } else if (key === "excludeTools") {
        converted.disabledTools = value;
      } else {
        converted[key] = omitPrototypePollutionKeysDeep(value);
      }
    }
    result[serverName] = converted;
  }

  return result;
}

/**
 * Tabnine CLI MCP configuration.
 *
 * Tabnine CLI reads `mcpServers` from `<project>/.tabnine/agent/settings.json`
 * (project scope) and `~/.tabnine/agent/settings.json` (user scope); the
 * project entry wins when both define the same server name. Both files hold
 * the user's other settings (`general`, `tools`, `hooks`, ...), so writes go
 * through the shared-config gateway with `mcpServers` as the only owned key
 * and the file is never deleted.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-agent/mcp-intro-and-setup/mcp-server-config
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings
 */
export class TabnineMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    // Fail closed on malformed JSON or a non-object root (`null`, an array, a
    // scalar), matching the write path's shared-config declaration, so a
    // broken settings file is surfaced rather than partially imported.
    this.json = parseSharedConfig({
      format: "json",
      fileContent: this.fileContent || "{}",
      filePath: join(this.relativeDirPath, this.relativeFilePath),
      invalidRootPolicy: "error",
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  /**
   * settings.json carries the user's other Tabnine settings, so it must not
   * be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: TABNINE_AGENT_DIR_PATH,
      relativeFilePath: TABNINE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<TabnineMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';

    return new TabnineMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<TabnineMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent =
      (await readFileContentOrNull(filePath)) ?? JSON.stringify({ mcpServers: {} }, null, 2);

    return new TabnineMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      // Use getMcpServers() (not getJson()) so rulesync-only fields are
      // stripped before writing the Tabnine settings file.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: { mcpServers: convertToTabnineFormat(rulesyncMcp.getMcpServers(), logger) },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromTabnineFormat(this.json.mcpServers);
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
  }: ToolMcpForDeletionParams): TabnineMcp {
    return new TabnineMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
