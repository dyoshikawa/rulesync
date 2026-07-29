import { join } from "node:path";

import {
  getZedGlobalDir,
  getZedOtherPlatformGlobalDir,
  ZED_DIR,
  ZED_SETTINGS_FILE_NAME,
} from "../../constants/zed-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, McpServers, McpServerSchema } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  McpServerConfig,
  resolveLocalMcpCommand,
  resolveRemoteMcpUrl,
  splitMcpServersByTransport,
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
 * MCP generator for the Zed editor.
 *
 * Zed configures MCP servers under the top-level `context_servers` key inside
 * its settings file (`.zed/settings.json` for project, `~/.config/zed/settings.json`
 * for global — `%APPDATA%\Zed\settings.json` on Windows). That file is also where
 * the ignore feature stores `private_files`, so reads and writes must merge into
 * the existing JSON rather than overwrite it.
 */

/**
 * The keys of the canonical server schema. Zed reads none of them under these
 * spellings, so anything on this list that the conversion below does not
 * translate is dropped; a key NOT on it is unknown to rulesync and passed
 * through untouched, so Zed-native fields (`oauth` on a remote server, an
 * extension server's `settings`) written in the tool-scoped `zed.mcpServers`
 * block survive.
 */
const CANONICAL_MCP_SERVER_KEYS = new Set(Object.keys(McpServerSchema.def.shape));

function passthroughNonCanonicalFields(serverConfig: McpServerConfig): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(serverConfig).filter(([key]) => !CANONICAL_MCP_SERVER_KEYS.has(key)),
  );
}

/**
 * Translate one canonical server into Zed's `context_servers` shape, or return
 * `null` (with a warning) for a server Zed cannot reach. Zed's value is an
 * untagged enum with no `type` field: a stdio server is `{command: string,
 * args?, env?, timeout?}`, a remote one `{url, headers?, timeout?}`, an
 * extension-provided one neither. `enabled` (default `true`) replaces the
 * canonical `disabled`, and is written only when the server is disabled — a
 * server that says nothing is enabled either way.
 *
 * @see https://zed.dev/docs/ai/mcp
 */
function convertServerToZedFormat({
  serverName,
  serverConfig,
  logger,
}: {
  serverName: string;
  serverConfig: McpServerConfig;
  logger?: Logger;
}): Record<string, unknown> | null {
  const passthrough = passthroughNonCanonicalFields(serverConfig);
  const disabledEntry = serverConfig.disabled === true ? { enabled: false } : {};

  // No transport at all: Zed's extension variant is exactly a server the entry
  // itself does not define, so the entry is written as one (typically carrying
  // a passed-through `settings` object) instead of being skipped. Canonical
  // fields have no place on that variant, so any beyond `disabled` are dropped
  // out loud (mirroring the Kilo toggle convention).
  if (declaresNoTransport(serverConfig)) {
    const droppedKeys = Object.keys(serverConfig).filter(
      (key) => CANONICAL_MCP_SERVER_KEYS.has(key) && key !== "disabled",
    );
    if (droppedKeys.length > 0) {
      logger?.warn(
        `Zed MCP: "${serverName}" declares no transport, so it is written as an extension-provided server without these fields: ${droppedKeys.join(", ")}.`,
      );
    }
    return { ...passthrough, ...disabledEntry };
  }

  if (isRemoteMcpServer(serverConfig)) {
    const transport = serverConfig.type ?? serverConfig.transport;
    if (transport === "sse" || transport === "ws") {
      return warnAndSkipMcpServer({
        toolName: "Zed",
        serverName,
        reason: `the "${transport}" transport, which Zed does not support`,
        logger,
      });
    }
    const url = resolveRemoteMcpUrl(serverConfig);
    if (url === undefined) {
      return warnAndSkipMcpServer({
        toolName: "Zed",
        serverName,
        reason: "a remote transport but no url",
        logger,
      });
    }
    return {
      ...passthrough,
      url,
      ...(serverConfig.headers !== undefined && { headers: serverConfig.headers }),
      ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
      ...disabledEntry,
    };
  }

  const command = resolveLocalMcpCommand(serverConfig);
  const [commandPath, ...args] = command;
  if (commandPath === undefined) {
    return warnAndSkipMcpServer({
      toolName: "Zed",
      serverName,
      reason: "a local transport but no command",
      logger,
    });
  }
  return {
    ...passthrough,
    command: commandPath,
    ...(args.length > 0 && { args }),
    ...(serverConfig.env !== undefined && { env: serverConfig.env }),
    ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
    ...disabledEntry,
  };
}

function convertServersToZedFormat(servers: McpServers, logger?: Logger): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const [serverName, serverConfig] of Object.entries(servers)) {
    const zedServer = convertServerToZedFormat({ serverName, serverConfig, logger });
    if (zedServer !== null) {
      converted[serverName] = zedServer;
    }
  }
  return converted;
}

/**
 * The inverse: a `context_servers` entry back to a canonical server. Only a
 * boolean `enabled` is translated; any other value is not a state Zed defines,
 * so it stays in place rather than having a disablement intent silently erased.
 */
function convertServerFromZedFormat(zedServer: Record<string, unknown>): McpServerConfig {
  if (typeof zedServer.enabled !== "boolean") {
    return zedServer;
  }
  const { enabled, ...rest } = zedServer;
  return enabled === false ? { ...rest, disabled: true } : rest;
}
export class ZedMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: getZedGlobalDir(),
        relativeFilePath: ZED_SETTINGS_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ZED_DIR,
      relativeFilePath: ZED_SETTINGS_FILE_NAME,
    };
  }

  /** @see getZedOtherPlatformGlobalDir */
  static getExtraSharedWritePaths({
    global = false,
  }: { global?: boolean } = {}): SharedWritePath[] {
    if (!global) {
      return [];
    }
    return [
      {
        relativeDirPath: getZedOtherPlatformGlobalDir(),
        relativeFilePath: ZED_SETTINGS_FILE_NAME,
      },
    ];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ZedMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? "{}";
    const json = JSON.parse(fileContent);
    const newJson = { ...json, context_servers: json.context_servers ?? {} };

    return new ZedMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<ZedMcp> {
    const paths = this.getSettablePaths({ global });

    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    return new ZedMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      // getMcpServers() strips rulesync-only fields; the conversion translates
      // the rest into the shapes Zed's untagged enum actually parses. Zed reads
      // `env`/`headers` as-is, so no env-var reference conversion is needed.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: { context_servers: convertServersToZedFormat(rulesyncMcp.getMcpServers(), logger) },
        filePath,
      }),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const contextServers = this.json.context_servers;
    const converted: McpServers = {};
    if (isMcpServers(contextServers)) {
      for (const [serverName, zedServer] of Object.entries(contextServers)) {
        // `isMcpServers` only guards the outer map; a hand-written file can
        // still hold a null or array entry, which is no server at all.
        if (zedServer === null || typeof zedServer !== "object" || Array.isArray(zedServer)) {
          continue;
        }
        converted[serverName] = convertServerFromZedFormat(zedServer);
      }
    }
    // An extension-provided server has no command or url of its own; in the
    // shared map every other tool would try (and fail) to write it as a server
    // it can start, so it goes in the block only Zed reads.
    const { shared, toolOnly } = splitMcpServersByTransport(converted);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          mcpServers: shared,
          ...(Object.keys(toolOnly).length > 0 && { zed: { mcpServers: toolOnly } }),
        },
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  /**
   * settings.json is a user-managed file shared with other features
   * (e.g. ignore's `private_files`), so it must not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): ZedMcp {
    return new ZedMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
