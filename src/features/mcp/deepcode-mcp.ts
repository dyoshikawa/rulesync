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
import { quoteValueForWarning } from "../../utils/quote-value.js";
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
  "envVars",
  "env_vars",
  "envHttpHeaders",
  "env_http_headers",
  "bearerTokenEnvVar",
  "bearer_token_env_var",
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
 * DeepCode's server-name rule (`validate_server_name`). A name outside it makes
 * DeepCode reject the whole layer's MCP configuration.
 */
const DEEPCODE_SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/**
 * DeepCode's `_SENSITIVE_NAME`: an `env` or `headers` key matching it makes
 * DeepCode reject the whole layer's MCP configuration whatever its value
 * (`validate_no_literal_secrets`), because native config must not hold
 * literal secrets.
 */
const DEEPCODE_SENSITIVE_NAME =
  /(?:^|[^a-z0-9])(?:authorization|cookie|(?:access|refresh|bearer)[-_]?token|api[-_]?key|password|passwd|secret|private[-_]?key)(?:$|[^a-z0-9])/i;

/** A value that is exactly one canonical `${VAR}` reference. */
const WHOLE_ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** An `Authorization` value that is exactly `Bearer ${VAR}`. */
const BEARER_ENV_REF = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/i;

/** DeepCode's own `env` placeholders, which it expands itself. */
const DEEPCODE_PLACEHOLDER_NAMES: ReadonlySet<string> = new Set(["workspace", "configDir"]);

function hasForeignPlaceholder(value: string): boolean {
  for (const match of value.matchAll(/\$\{([^}]*)\}/g)) {
    if (!DEEPCODE_PLACEHOLDER_NAMES.has(match[1] ?? "")) return true;
  }
  return false;
}

function warnDroppedKey({
  serverName,
  field,
  key,
  reason,
  logger,
}: {
  serverName: string;
  field: string;
  key: string;
  reason: string;
  logger?: Logger;
}): void {
  logger?.warn(
    `${TOOL_NAME} MCP server ${quoteValueForWarning(serverName)}: dropping ${field}.${quoteValueForWarning(key)} because ${reason}.`,
  );
}

/**
 * Translate a canonical stdio `env` map. DeepCode does not expand `${VAR}` in
 * `env` (only its own `${workspace}` / `${configDir}`) and rejects a key that
 * looks sensitive whatever its value, so:
 * - `NAME: "${NAME}"` becomes an `envVars` entry (DeepCode forwards `NAME` from
 *   its own environment);
 * - any other value with a `${...}` reference, and a literal value under a
 *   sensitive-looking key, is dropped with a warning;
 * - every other value is written as a literal `env` entry.
 */
function toDeepcodeEnv({
  serverName,
  env,
  logger,
}: {
  serverName: string;
  env: Record<string, string>;
  logger?: Logger;
}): Record<string, unknown> {
  const literal: Record<string, string> = {};
  const forwarded: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    const reference = WHOLE_ENV_REF.exec(value)?.[1];
    if (reference !== undefined && reference === key) {
      forwarded.push(key);
      continue;
    }
    if (hasForeignPlaceholder(value)) {
      warnDroppedKey({
        serverName,
        field: "env",
        key,
        reason:
          "DeepCode only forwards a variable under its own name (envVars) and does not expand other ${...} references",
        logger,
      });
      continue;
    }
    if (DEEPCODE_SENSITIVE_NAME.test(key)) {
      warnDroppedKey({
        serverName,
        field: "env",
        key,
        reason: `DeepCode refuses literal secrets in its config; write it as "${key}": "\${${key}}" to forward it from the environment`,
        logger,
      });
      continue;
    }
    literal[key] = value;
  }
  return {
    ...(Object.keys(literal).length > 0 && { env: literal }),
    ...(forwarded.length > 0 && { envVars: forwarded }),
  };
}

/**
 * Translate canonical remote `headers`. DeepCode sends `headers` verbatim and
 * rejects a header name that looks sensitive whatever its value, so:
 * - `Authorization: Bearer ${VAR}` becomes `bearerTokenEnvVar: "VAR"`;
 * - a header whose whole value is `${VAR}` becomes an `envHttpHeaders` entry;
 * - any other value with a `${...}` reference, and a literal value under a
 *   sensitive-looking name, is dropped with a warning;
 * - every other header is written as a literal `headers` entry.
 */
function toDeepcodeHeaders({
  serverName,
  headers,
  logger,
}: {
  serverName: string;
  headers: Record<string, string>;
  logger?: Logger;
}): Record<string, unknown> {
  const literal: Record<string, string> = {};
  const fromEnv: Record<string, string> = {};
  let bearerTokenEnvVar: string | undefined;
  for (const [name, value] of Object.entries(headers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    const bearer = BEARER_ENV_REF.exec(value)?.[1];
    if (bearer !== undefined && name.toLowerCase() === "authorization") {
      bearerTokenEnvVar ??= bearer;
      continue;
    }
    const reference = WHOLE_ENV_REF.exec(value)?.[1];
    if (reference !== undefined) {
      fromEnv[name] = reference;
      continue;
    }
    if (value.includes("${")) {
      warnDroppedKey({
        serverName,
        field: "headers",
        key: name,
        reason:
          'DeepCode sends headers verbatim; only "Authorization: Bearer ${VAR}" and a whole-value "${VAR}" can be read from the environment',
        logger,
      });
      continue;
    }
    if (DEEPCODE_SENSITIVE_NAME.test(name)) {
      warnDroppedKey({
        serverName,
        field: "headers",
        key: name,
        reason:
          'DeepCode refuses literal secrets in its config; use a "${VAR}" reference to read it from the environment',
        logger,
      });
      continue;
    }
    literal[name] = value;
  }
  return {
    ...(Object.keys(literal).length > 0 && { headers: literal }),
    ...(Object.keys(fromEnv).length > 0 && { envHttpHeaders: fromEnv }),
    ...(bearerTokenEnvVar !== undefined && { bearerTokenEnvVar }),
  };
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
    if (isStringRecord(config.headers)) {
      Object.assign(entry, toDeepcodeHeaders({ serverName, headers: config.headers, logger }));
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
    if (config.env) {
      Object.assign(entry, toDeepcodeEnv({ serverName, env: config.env, logger }));
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
 * `credentialEnv`, `requiredEnvVars`, ...): every key rulesync does not
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
 * The other ways of supplying a bearer token, which DeepCode accepts only one
 * of: dropped from the preserved keys when `bearerTokenEnvVar` is generated.
 */
const DEEPCODE_BEARER_ALTERNATIVES = ["bearerTokenCredential", "bearer_token_credential", "auth"];

/** Combine a generated entry with the native keys kept from the existing one. */
function mergeWithPreserved({
  entry,
  preserved,
}: {
  entry: Record<string, unknown>;
  preserved: Record<string, unknown>;
}): Record<string, unknown> {
  const kept = { ...preserved };
  if (entry.bearerTokenEnvVar !== undefined) {
    for (const key of DEEPCODE_BEARER_ALTERNATIVES) delete kept[key];
  }
  return { ...entry, ...kept };
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
    if (!DEEPCODE_SERVER_NAME.test(serverName)) {
      warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName,
        reason:
          "a name DeepCode rejects (1-80 letters, digits, dots, dashes or underscores, starting with a letter or digit)",
        logger,
      });
      continue;
    }
    const converted = toDeepcodeServer({ serverName, config, logger });
    if (converted === null) continue;
    const existing = Object.hasOwn(existingServers, serverName)
      ? existingServers[serverName]
      : undefined;
    result[serverName] = mergeWithPreserved({
      entry: converted.entry,
      preserved: preservedNativeKeys({ existing, transport: converted.transport }),
    });
  }
  return result;
}

/**
 * Convert DeepCode's `mcpServers` back to canonical servers. Only the keys
 * rulesync models are imported: `streamableHttp` becomes `http`,
 * `enabled: false` becomes `disabled: true`, `envVars` entries become
 * `NAME: "${NAME}"` env entries, `envHttpHeaders` and `bearerTokenEnvVar`
 * become `${VAR}` headers (`Authorization: Bearer ${VAR}`), and the
 * snake_case spellings are read too. Native-only keys (`approvalMode`, `tools`,
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
  const env = envFromDeepcode(config);
  if (Object.keys(env).length > 0) converted.env = env;
  if (typeof config.url === "string") converted.url = config.url;
  const headers = headersFromDeepcode(config);
  if (Object.keys(headers).length > 0) converted.headers = headers;
  return converted;
}

/** Literal `env` plus each `envVars` name as a `NAME: "${NAME}"` reference. */
function envFromDeepcode(config: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = isStringRecord(config.env) ? { ...config.env } : {};
  const envVars = config.envVars ?? config.env_vars;
  for (const name of isStringArray(envVars) ? envVars : []) {
    env[name] ??= `\${${name}}`;
  }
  return env;
}

/** Literal `headers` plus `envHttpHeaders` / `bearerTokenEnvVar` as `${VAR}` references. */
function headersFromDeepcode(config: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = isStringRecord(config.headers)
    ? { ...config.headers }
    : {};
  const envHeaders = config.envHttpHeaders ?? config.env_http_headers;
  for (const [name, variable] of Object.entries(isStringRecord(envHeaders) ? envHeaders : {})) {
    headers[name] = `\${${variable}}`;
  }
  const bearer = config.bearerTokenEnvVar ?? config.bearer_token_env_var;
  if (typeof bearer === "string") headers.Authorization = `Bearer \${${bearer}}`;
  return headers;
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
