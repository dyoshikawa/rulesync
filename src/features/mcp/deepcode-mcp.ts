import { join } from "node:path";

import {
  DEEPCODE_CONFIG_FILE_NAME,
  DEEPCODE_DIR,
  DEEPCODE_MCP_SERVERS_KEY,
} from "../../constants/deepcode-paths.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfigFile,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  resolveHttpOrSseRemoteType,
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

const TOOL_NAME = "DeepCode";

/**
 * The per-server keys rulesync computes from the canonical config. On
 * regeneration they are always taken from the canonical server (and dropped
 * when it no longer states them); the snake_case aliases DeepCode also accepts
 * are dropped so a stale spelling cannot contradict the generated one.
 */
const DEEPCODE_MANAGED_SERVER_KEYS: ReadonlySet<string> = new Set([
  "type",
  "command",
  "args",
  "cwd",
  "env",
  "url",
  "headers",
  "enabled",
  "enabledTools",
  "enabled_tools",
  "disabledTools",
  "disabled_tools",
  "description",
]);

/**
 * Native keys DeepCode accepts only on HTTP (`sse` / `streamableHttp`) servers.
 * A stdio server carrying any of them fails validation, so they are not kept
 * when a server is (re)written as stdio.
 */
const DEEPCODE_HTTP_ONLY_KEYS: ReadonlySet<string> = new Set([
  "auth",
  "envHttpHeaders",
  "env_http_headers",
  "envUrlParams",
  "env_url_params",
  "bearerTokenEnvVar",
  "bearer_token_env_var",
  "bearerTokenCredential",
  "bearer_token_credential",
]);

/**
 * Native keys DeepCode accepts only on stdio servers. An HTTP server carrying
 * any of them fails validation, so they are not kept when a server is
 * (re)written as `sse` / `streamableHttp`.
 */
const DEEPCODE_STDIO_ONLY_KEYS: ReadonlySet<string> = new Set([
  "envVars",
  "env_vars",
  "requiredEnvVars",
  "required_env_vars",
  "credentialEnv",
  "credential_env",
]);

type DeepcodeTransport = "stdio" | "sse" | "streamableHttp";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

/**
 * Build one DeepCode server entry from a canonical server, or `null` when it
 * cannot be expressed (a warning is logged). DeepCode infers no transport, so
 * `type` is always written: `stdio` for a command, `sse` for an SSE URL and
 * `streamableHttp` for any other HTTP URL. A canonical `disabled: true` maps
 * to `enabled: false` (DeepCode defaults `enabled` to true).
 */
function toDeepcodeServer({
  serverName,
  config,
  logger,
}: {
  serverName: string;
  config: McpServers[string];
  logger?: Logger;
}): { transport: DeepcodeTransport; entry: Record<string, unknown> } | null {
  if (declaresNoTransport(config)) {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName,
      reason: "no command or url",
      logger,
    });
  }

  const entry: Record<string, unknown> = {};
  let transport: DeepcodeTransport;
  if (isRemoteMcpServer(config)) {
    const url = resolveRemoteMcpUrl(config);
    if (url === undefined) {
      return warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName,
        reason: "a remote transport without a url",
        logger,
      });
    }
    const remoteType = resolveHttpOrSseRemoteType({ stated: config.type ?? config.transport, url });
    if (remoteType === undefined) {
      return warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName,
        reason: "a transport DeepCode does not support (only stdio, sse and streamableHttp)",
        logger,
      });
    }
    transport = remoteType === "sse" ? "sse" : "streamableHttp";
    entry.type = transport;
    entry.url = url;
    if (isStringRecord(config.headers) && Object.keys(config.headers).length > 0) {
      entry.headers = config.headers;
    }
  } else {
    const commandArray = resolveLocalMcpCommand(config);
    const [command, ...args] = commandArray;
    if (command === undefined) {
      return warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName,
        reason: "a local transport without a command",
        logger,
      });
    }
    transport = "stdio";
    entry.type = transport;
    entry.command = command;
    if (args.length > 0) {
      entry.args = args;
    }
    if (typeof config.cwd === "string") {
      entry.cwd = config.cwd;
    }
    if (config.env && Object.keys(config.env).length > 0) {
      entry.env = config.env;
    }
  }

  if (config.disabled === true) {
    entry.enabled = false;
  }
  if (isStringArray(config.enabledTools)) {
    entry.enabledTools = config.enabledTools;
  }
  if (isStringArray(config.disabledTools)) {
    entry.disabledTools = config.disabledTools;
  }
  if (typeof config.description === "string") {
    entry.description = config.description;
  }
  return { transport, entry };
}

/**
 * The native-only keys of an existing server entry that a regenerated entry
 * keeps (`approvalMode`, per-tool `tools` policies, timeouts,
 * `credentialEnv`, `bearerTokenEnvVar`, ...): every key rulesync does not
 * compute, minus those DeepCode rejects on the server's new transport.
 */
function preservedNativeKeys({
  existing,
  transport,
}: {
  existing: unknown;
  transport: DeepcodeTransport;
}): Record<string, unknown> {
  if (!isRecord(existing)) return {};
  const excluded = transport === "stdio" ? DEEPCODE_HTTP_ONLY_KEYS : DEEPCODE_STDIO_ONLY_KEYS;
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    if (DEEPCODE_MANAGED_SERVER_KEYS.has(key) || excluded.has(key)) continue;
    preserved[key] = value;
  }
  return preserved;
}

/**
 * Convert canonical servers to DeepCode's `mcpServers` map. DeepCode rejects
 * unknown keys on a server entry, so the generated part is a whitelist; the
 * native-only keys of a server already present in `existingServers` are
 * carried over (see {@link preservedNativeKeys}). Servers not in the canonical
 * config are not kept: the map is a snapshot of `.rulesync/mcp.jsonc`.
 */
export function convertToDeepcodeFormat({
  mcpServers,
  existingServers = {},
  logger,
}: {
  mcpServers: McpServers;
  existingServers?: Record<string, unknown>;
  logger?: Logger;
}): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [serverName, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName)) continue;
    const converted = toDeepcodeServer({ serverName, config, logger });
    if (converted === null) continue;
    const existing = Object.hasOwn(existingServers, serverName)
      ? existingServers[serverName]
      : undefined;
    result[serverName] = {
      ...converted.entry,
      ...preservedNativeKeys({ existing, transport: converted.transport }),
    };
  }
  return result;
}

/**
 * Convert DeepCode's `mcpServers` back to canonical servers. Only the keys
 * rulesync models are imported: `streamableHttp` becomes `http`,
 * `enabled: false` becomes `disabled: true`, and the snake_case tool filter
 * spellings are read too. Native-only keys (`approvalMode`, `tools`,
 * `credentialEnv`, timeouts, ...) are not imported, because several of them
 * clash with canonical keys of the same name or point at DeepCode's private
 * credential store; they stay in `deepcode_config.json`, where the next
 * generate keeps them.
 */
export function convertFromDeepcodeFormat({
  deepcodeServers,
}: {
  deepcodeServers: Record<string, unknown>;
}): McpServers {
  const result: McpServers = {};
  for (const [name, config] of Object.entries(deepcodeServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    result[name] = { ...transportFromDeepcode(config), ...settingsFromDeepcode(config) };
  }
  return result;
}

/** The canonical transport keys of one DeepCode server entry. */
function transportFromDeepcode(config: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  const { type } = config;
  if (type === "stdio" || type === "sse") {
    converted.type = type;
  } else if (type === "streamableHttp") {
    converted.type = "http";
  }
  if (typeof config.command === "string") converted.command = config.command;
  if (isStringArray(config.args) && config.args.length > 0) converted.args = config.args;
  if (typeof config.cwd === "string") converted.cwd = config.cwd;
  if (isStringRecord(config.env) && Object.keys(config.env).length > 0) {
    converted.env = config.env;
  }
  if (typeof config.url === "string") converted.url = config.url;
  if (isStringRecord(config.headers) && Object.keys(config.headers).length > 0) {
    converted.headers = config.headers;
  }
  return converted;
}

/** The canonical enable flag, tool filters and description of one DeepCode server entry. */
function settingsFromDeepcode(config: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  if (config.enabled === false) converted.disabled = true;
  const enabledTools = config.enabledTools ?? config.enabled_tools;
  if (isStringArray(enabledTools)) converted.enabledTools = enabledTools;
  const disabledTools = config.disabledTools ?? config.disabled_tools;
  if (isStringArray(disabledTools) && disabledTools.length > 0) {
    converted.disabledTools = disabledTools;
  }
  if (typeof config.description === "string") converted.description = config.description;
  return converted;
}

/**
 * DeepCode MCP servers.
 *
 * DeepCode reads top-level `mcpServers` from `deepcode_config.json`: the
 * project file at the project root (honored only in a trusted project) and
 * the user file `~/.deepcode/deepcode_config.json`. Every other key of the
 * file is preserved, and the file is never deleted.
 *
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/integrations/MCP.md
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/configuration.md
 */
export class DeepcodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseSharedConfigFile({
      fileKey: sharedConfigFileKey(DeepcodeMcp.getSettablePaths({ global: this.global })),
      fileContent: this.fileContent ?? "",
      filePath: join(this.relativeDirPath, this.relativeFilePath),
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // deepcode_config.json is DeepCode's primary config file, so it must never
    // be removed wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: global ? DEEPCODE_DIR : ".",
      relativeFilePath: DEEPCODE_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<DeepcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";

    return new DeepcodeMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<DeepcodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseSharedConfigFile({
      fileKey: sharedConfigFileKey(paths),
      fileContent: existingContent,
      filePath,
    });
    const existingServers = isRecord(existing[DEEPCODE_MCP_SERVERS_KEY])
      ? existing[DEEPCODE_MCP_SERVERS_KEY]
      : {};

    const converted = convertToDeepcodeFormat({
      mcpServers: rulesyncMcp.getMcpServers(),
      existingServers,
      logger,
    });

    return new DeepcodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: { [DEEPCODE_MCP_SERVERS_KEY]: converted },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = isRecord(this.json[DEEPCODE_MCP_SERVERS_KEY])
      ? this.json[DEEPCODE_MCP_SERVERS_KEY]
      : {};
    const converted = convertFromDeepcodeFormat({ deepcodeServers: servers });

    // Do not spread the full config JSON: DeepCode's own keys (security,
    // agents, providers, ...) must not leak into rulesync mcp.json.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: converted }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): DeepcodeMcp {
    // The shared config file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new DeepcodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ [DEEPCODE_MCP_SERVERS_KEY]: {} }, null, 2),
      validate: false,
      global,
    });
  }
}
