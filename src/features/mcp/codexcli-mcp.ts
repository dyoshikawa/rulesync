import { createHash } from "node:crypto";
import { join } from "node:path";

import * as smolToml from "smol-toml";

import { CODEXCLI_DIR, CODEXCLI_MCP_FILE_NAME } from "../../constants/codexcli-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isEnvVarEntryArray, McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord, isStringArray } from "../../utils/type-guards.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  type ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const CODEX_TO_RULESYNC_FIELD_MAP: Record<string, string> = {
  enabled_tools: "enabledTools",
  disabled_tools: "disabledTools",
  env_vars: "envVars",
};

const RULESYNC_TO_CODEX_FIELD_MAP: Record<string, string> = {
  enabledTools: "enabled_tools",
  disabledTools: "disabled_tools",
  envVars: "env_vars",
};

const RULESYNC_TO_CODEX_SCALAR_FIELD_MAP: Record<string, string> = {
  experimentalEnvironment: "experimental_environment",
};

const CODEX_TO_RULESYNC_SCALAR_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(RULESYNC_TO_CODEX_SCALAR_FIELD_MAP).map(([canonical, codex]) => [
    codex,
    canonical,
  ]),
);

const MAX_REMOVE_EMPTY_ENTRIES_DEPTH = 32;

/**
 * Canonical per-server keys Codex has no counterpart for.
 *
 * Codex's deserializer (`RawMcpServerConfig`) does not reject unknown keys, so
 * these are inert rather than fatal — but they are rulesync's own spellings and
 * only add noise to a hand-edited `config.toml`. `type`/`transport` are safe to
 * drop because Codex infers the transport from `command` versus `url`.
 * `tools` is handled separately: it is fatal rather than inert.
 * @see https://github.com/openai/codex/blob/rust-v0.146.1/codex-rs/config/src/mcp_types.rs
 */
const CODEX_UNSUPPORTED_CANONICAL_KEYS = new Set([
  "type",
  "transport",
  "alwaysAllow",
  "trust",
  "kiroAutoApprove",
  "kiroAutoBlock",
]);

/**
 * Canonical millisecond timeouts and the Codex fields they translate to.
 * Codex takes both as seconds (`f64`), so the value is divided by 1000 and a
 * fractional result is emitted as-is.
 * - `timeout` → `tool_timeout_sec`: default timeout for tool calls on the server.
 * - `networkTimeout` → `startup_timeout_sec`: initialize + list-tools timeout.
 */
const RULESYNC_TO_CODEX_TIMEOUT_FIELD_MAP: Record<string, string> = {
  timeout: "tool_timeout_sec",
  networkTimeout: "startup_timeout_sec",
};

const CODEX_TO_RULESYNC_TIMEOUT_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(RULESYNC_TO_CODEX_TIMEOUT_FIELD_MAP).map(([canonical, codex]) => [
    codex,
    canonical,
  ]),
);

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Whether a value is usable as a timeout. Codex builds a `Duration` out of both
 * timeout fields, and `Duration::try_from_secs_f64` errors on a negative value —
 * which fails the whole `config.toml`, not just the one server — so a negative
 * timeout is rejected here rather than written.
 */
function isTimeoutValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Whether a value is usable as the canonical `headers` map, whose schema is
 * `record(string, string)`. Checked in both directions so a hand-written
 * `http_headers` can never be imported into a `.rulesync/mcp.jsonc` that the
 * next generate would refuse to parse.
 */
function isHeadersRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * Whether a server config describes a Codex stdio server. Codex branches on
 * `command` first; a config carrying both `command` and `url` is classified as
 * stdio here, which matches upstream in the sense that it never reaches the
 * remote arm — upstream rejects that combination outright ("url is not
 * supported for stdio").
 */
function isCodexStdioServer(config: Record<string, unknown>): boolean {
  return config["command"] !== undefined;
}

/**
 * `env_vars` entries are either a bare variable name or `{ name, source }`,
 * where `source = "remote"` reads the variable from the remote executor
 * environment. The other renamed keys (`enabled_tools`, `disabled_tools`) stay
 * plain string arrays, so the widened check applies to `env_vars` only.
 * @see https://learn.chatgpt.com/docs/extend/mcp
 */
function isValidRenamedArray(key: string, value: unknown): boolean {
  return key === "env_vars" || key === "envVars" ? isEnvVarEntryArray(value) : isStringArray(value);
}

/**
 * Translate a server's `oauth` table from the canonical rulesync shape (Claude
 * Code style camelCase) into the shape Codex CLI understands. Codex expects the
 * OAuth client id under snake_case `client_id`; without it `codex mcp login`
 * falls back to dynamic client registration and fails for providers that do not
 * support it (e.g. Slack, see #2158). The canonical `clientId` is kept alongside
 * the added `client_id` so tools that read the camelCase shape keep working and
 * the round-trip stays stable.
 */
function mapOauthToCodex(oauth: Record<string, unknown>): Record<string, unknown> {
  const result = omitPrototypePollutionKeys(oauth);
  // Only a string client id is duplicated: Codex's `client_id` must be a bare
  // string, and a non-string value would not be a usable OAuth client id anyway.
  if (typeof oauth["clientId"] === "string" && !("client_id" in result)) {
    result["client_id"] = oauth["clientId"];
  }
  return result;
}

/**
 * Reverse of {@link mapOauthToCodex}: collapse Codex's `oauth.client_id` back to
 * the canonical `clientId` on import. When both keys are present (the shape
 * rulesync itself emits) the canonical `clientId` wins and `client_id` is
 * dropped so a subsequent generate does not accumulate duplicates.
 */
function mapOauthFromCodex(oauth: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(oauth)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    if (key === "client_id") {
      if (!("clientId" in oauth)) result["clientId"] = value;
      continue;
    }
    result[key] = value;
  }
  return result;
}

const CODEX_MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function normalizeCodexMcpServerName(name: string): { codexName: string; usedFallback: boolean } {
  if (!PROTOTYPE_POLLUTION_KEYS.has(name) && CODEX_MCP_SERVER_NAME_PATTERN.test(name)) {
    return { codexName: name, usedFallback: false };
  }

  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalizedName && !PROTOTYPE_POLLUTION_KEYS.has(normalizedName)) {
    return { codexName: normalizedName, usedFallback: false };
  }

  // Names with no ASCII-representable characters at all (e.g. a fully
  // Japanese name like 日本語サーバー) or that normalize to a
  // prototype-pollution key fall back to a stable hash-derived name instead
  // of being dropped, so the server still reaches the Codex config.
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return { codexName: `mcp_${hash}`, usedFallback: true };
}

/** Outcome of a key translation: no entry means the key is dropped. */
type TranslatedKey = { entry?: [string, unknown] };

/**
 * Translate the Codex-native per-server keys that carry a canonical
 * counterpart under a different name or unit. Returns `undefined` for a key
 * this translation does not own, leaving it to the caller's other branches.
 */
function translateCodexOnlyKey({
  key,
  value,
  config,
  serverName,
}: {
  key: string;
  value: unknown;
  config: Record<string, unknown>;
  serverName: string;
}): TranslatedKey | undefined {
  if (key === "tools") {
    // Codex's per-tool approval table is CLI-written state that rulesync does
    // not model — and it is shaped nothing like the canonical `tools` string
    // array, so lifting it would produce a `.rulesync/mcp.jsonc` the schema
    // rejects. It stays in `config.toml`, where the generate path carries it
    // across regenerates untouched.
    return {};
  }
  if (key === "http_headers") {
    // Codex's spelling of the canonical `headers`. A config rulesync wrote
    // carries only `http_headers`; if a hand-written file has both, the
    // canonical key wins, mirroring `oauth.client_id` / `oauth.clientId`.
    if ("headers" in config) return {};
    if (isHeadersRecord(value)) {
      return { entry: ["headers", omitPrototypePollutionKeys(value)] };
    }
    warnWithFallback(
      undefined,
      `Ignored malformed value for ${key} in MCP server ${serverName}: expected a table of string values`,
    );
    return {};
  }
  const mappedKey = CODEX_TO_RULESYNC_TIMEOUT_FIELD_MAP[key];
  if (mappedKey) {
    if (isTimeoutValue(value)) return { entry: [mappedKey, value * MILLISECONDS_PER_SECOND] };
    warnWithFallback(
      undefined,
      `Ignored malformed value for ${key} in MCP server ${serverName}: expected a non-negative number of seconds`,
    );
    return {};
  }
  if (key === "startup_timeout_ms") {
    // Codex accepts the startup timeout in either unit and prefers
    // `startup_timeout_sec` when both are set, so the millisecond spelling is
    // only read when the seconds one is absent. Canonical `networkTimeout` is
    // already in milliseconds, so no conversion.
    if ("startup_timeout_sec" in config) return {};
    if (isTimeoutValue(value)) return { entry: ["networkTimeout", value] };
    warnWithFallback(
      undefined,
      `Ignored malformed value for ${key} in MCP server ${serverName}: expected a non-negative number of milliseconds`,
    );
    return {};
  }
  return undefined;
}

/**
 * Translate the canonical per-server keys that Codex spells differently, reads
 * in another unit, or cannot accept at all. Returns `undefined` for a key this
 * translation does not own.
 */
function translateCanonicalKeyToCodex({
  key,
  value,
  isStdio,
  serverName,
}: {
  key: string;
  value: unknown;
  isStdio: boolean;
  serverName: string;
}): TranslatedKey | undefined {
  if (key === "tools") {
    // Codex declares `tools` as a table of per-tool approval settings
    // (`tools.<tool>.approval_mode`), while the canonical `tools` is a string
    // array. A TOML array where Codex expects a table is a serde type error
    // that takes the whole server entry down, so it is dropped rather than
    // written. Codex's own per-tool approvals live in the same key and are
    // preserved from the existing file instead. That is the "refuse the
    // canonical value" branch of the collision rule documented on
    // `enabledTools` in `src/types/mcp.ts` — it applies here because Codex's
    // same-named key means a different thing; `kiro-mcp.ts` merges instead and
    // `copilotcli-mcp.ts` lets the canonical value win instead.
    warnWithFallback(
      undefined,
      `[CodexCliMcp] Dropping 'tools' from MCP server "${serverName}": Codex reads it as a per-tool approval table, not a tool allowlist. Use 'enabledTools' / 'disabledTools' instead.`,
    );
    return {};
  }
  if (CODEX_UNSUPPORTED_CANONICAL_KEYS.has(key)) {
    // Inert in Codex, and `type`/`transport` appear on nearly every remote
    // canonical server, so these are dropped without a warning.
    return {};
  }
  if (key === "headers") {
    if (!isHeadersRecord(value)) {
      warnWithFallback(
        undefined,
        `[CodexCliMcp] Skipping invalid value type for mapped key 'headers': expected a table of string values, got ${typeof value}`,
      );
      return {};
    }
    if (isStdio) {
      // Codex rejects `http_headers` on a stdio server outright ("http_headers
      // is not supported for stdio"), which would fail the whole entry, so the
      // headers are dropped instead.
      warnWithFallback(
        undefined,
        `[CodexCliMcp] Dropping 'headers' from stdio MCP server "${serverName}": Codex accepts HTTP headers only on url-based servers.`,
      );
      return {};
    }
    return { entry: ["http_headers", omitPrototypePollutionKeys(value)] };
  }
  const mappedKey = RULESYNC_TO_CODEX_TIMEOUT_FIELD_MAP[key];
  if (mappedKey) {
    if (isTimeoutValue(value)) return { entry: [mappedKey, value / MILLISECONDS_PER_SECOND] };
    warnWithFallback(
      undefined,
      `[CodexCliMcp] Skipping invalid value type for mapped key '${key}': expected a non-negative number of milliseconds, got ${typeof value}`,
    );
    return {};
  }
  return undefined;
}

/**
 * Codex states no transport of its own — it infers one from `command` versus
 * `url`, which is why generate drops the canonical `type`. Restate it for a url
 * server on the way back, so a config imported from Codex reaches the adapters
 * that branch on `type` as a remote server rather than one with no transport at
 * all. `streamable_http` is Codex's only remote transport, and canonical spells
 * that `http`.
 */
function restateCanonicalTransport(converted: Record<string, unknown>): void {
  if (converted["type"] !== undefined) return;
  if (isCodexStdioServer(converted)) return;
  if (typeof converted["url"] !== "string") return;
  converted["type"] = "http";
}

function convertFromCodexFormat(codexMcp: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(codexMcp)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      const codexOnly = translateCodexOnlyKey({ key, value, config, serverName: name });
      if (codexOnly) {
        if (codexOnly.entry) converted[codexOnly.entry[0]] = codexOnly.entry[1];
      } else if (key === "enabled") {
        if (value === false) {
          converted["disabled"] = true;
        }
      } else if (key === "oauth" && isRecord(value)) {
        converted[key] = mapOauthFromCodex(value);
      } else if (Object.hasOwn(CODEX_TO_RULESYNC_FIELD_MAP, key)) {
        const mappedKey = CODEX_TO_RULESYNC_FIELD_MAP[key];
        if (mappedKey) {
          if (isValidRenamedArray(key, value)) {
            converted[mappedKey] = value;
          } else {
            warnWithFallback(undefined, `Ignored malformed array for ${key} in MCP server ${name}`);
          }
        }
      } else if (Object.hasOwn(CODEX_TO_RULESYNC_SCALAR_FIELD_MAP, key)) {
        const mappedKey = CODEX_TO_RULESYNC_SCALAR_FIELD_MAP[key];
        if (mappedKey) {
          if (typeof value === "string") {
            converted[mappedKey] = value;
          } else {
            warnWithFallback(
              undefined,
              `Ignored malformed value for ${key} in MCP server ${name}: expected a string`,
            );
          }
        }
      } else {
        converted[key] = value;
      }
    }

    restateCanonicalTransport(converted);

    result[name] = converted;
  }

  return result;
}

function convertToCodexFormat(mcpServers: McpServers): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};
  const originalNames = new Map<string, string>();

  for (const [name, config] of Object.entries(mcpServers)) {
    if (!isRecord(config)) continue;
    const { codexName, usedFallback } = normalizeCodexMcpServerName(name);
    if (usedFallback) {
      warnWithFallback(
        undefined,
        `MCP server "${name}" cannot be represented as a Codex MCP server name (ASCII [a-zA-Z0-9_-] only), so the stable fallback name "${codexName}" was used. Rename the server in .rulesync/mcp.jsonc to choose a readable Codex name.`,
      );
    }
    const converted: Record<string, unknown> = {};
    const isStdio = isCodexStdioServer(config);
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      const translated = translateCanonicalKeyToCodex({ key, value, isStdio, serverName: name });
      if (translated) {
        if (translated.entry) converted[translated.entry[0]] = translated.entry[1];
      } else if (key === "disabled") {
        if (value === true) {
          converted["enabled"] = false;
        }
      } else if (key === "oauth" && isRecord(value)) {
        converted[key] = mapOauthToCodex(value);
      } else if (Object.hasOwn(RULESYNC_TO_CODEX_FIELD_MAP, key)) {
        const mappedKey = RULESYNC_TO_CODEX_FIELD_MAP[key];
        if (mappedKey) {
          if (isValidRenamedArray(key, value)) {
            converted[mappedKey] = value;
          } else {
            warnWithFallback(
              undefined,
              `[CodexCliMcp] Skipping invalid value type for mapped key '${key}': expected string array, got ${typeof value}`,
            );
          }
        }
      } else if (Object.hasOwn(RULESYNC_TO_CODEX_SCALAR_FIELD_MAP, key)) {
        const mappedKey = RULESYNC_TO_CODEX_SCALAR_FIELD_MAP[key];
        if (mappedKey) {
          if (typeof value === "string") {
            converted[mappedKey] = value;
          } else {
            warnWithFallback(
              undefined,
              `[CodexCliMcp] Skipping invalid value type for mapped key '${key}': expected string, got ${typeof value}`,
            );
          }
        }
      } else {
        converted[key] = value;
      }
    }

    const previousName = originalNames.get(codexName);
    if (previousName !== undefined) {
      // Worded as an overwrite (not "will be used") because the surviving
      // entry can still be dropped later by removeEmptyEntries when its
      // config is empty — in that case its own dropped-entry warning fires.
      warnWithFallback(
        undefined,
        `Codex MCP server name collision: "${previousName}" and "${name}" both normalize to "${codexName}"; "${name}" (processed last) overwrites "${previousName}".`,
      );
    }
    originalNames.set(codexName, name);
    result[codexName] = converted;
  }

  return result;
}

export class CodexcliMcp extends ToolMcp {
  private readonly toml: smolToml.TomlTable;

  constructor({ ...rest }: ToolMcpParams) {
    super({
      ...rest,
      validate: false,
    });

    let toml: smolToml.TomlTable;
    try {
      toml = smolToml.parse(this.fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Codex CLI config at ${this.getFilePath()}: ${formatError(error)}`,
        { cause: error },
      );
    }
    this.toml = toml;

    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  getToml(): smolToml.TomlTable {
    return this.toml;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Both global (~/.codex/config.toml) and local (.codex/config.toml) use the same
    // relative path. The difference is resolved by the outputRoot passed to the processor.
    return {
      relativeDirPath: CODEXCLI_DIR,
      relativeFilePath: CODEXCLI_MCP_FILE_NAME,
    };
  }

  /**
   * config.toml may contain other Codex settings, so it should not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CodexcliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? smolToml.stringify({});

    return new CodexcliMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<CodexcliMcp> {
    const paths = this.getSettablePaths({ global });

    const configTomlFilePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const configTomlFileContent = (await readFileContentOrNull(configTomlFilePath)) ?? "";

    let configToml: smolToml.TomlTable;
    try {
      configToml = smolToml.parse(configTomlFileContent || smolToml.stringify({}));
    } catch (error) {
      throw new Error(
        `Failed to parse existing Codex CLI config at ${configTomlFilePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const strippedMcpServers = rulesyncMcp.getMcpServers();
    const mcpServersWithCodexFields = Object.fromEntries(
      Object.entries(strippedMcpServers).map(([serverName, serverConfig]) => {
        const rawServer = rulesyncMcp.getRawMcpServer(serverName);
        return [
          serverName,
          {
            ...serverConfig,
            // Only the codex-only fields stripped by `getMcpServers()` need
            // manual re-merging here. Other codex-specific fields (like
            // disabledTools) are preserved by RulesyncMcp's filtering natively.
            ...(isRecord(rawServer) && isEnvVarEntryArray(rawServer.envVars)
              ? { envVars: rawServer.envVars }
              : {}),
            // Both spellings are accepted, so a server config copied straight
            // out of a codex `config.toml` keeps working; the canonical
            // camelCase form wins when someone wrote both.
            ...(isRecord(rawServer) && typeof rawServer.experimental_environment === "string"
              ? { experimentalEnvironment: rawServer.experimental_environment }
              : {}),
            ...(isRecord(rawServer) && typeof rawServer.experimentalEnvironment === "string"
              ? { experimentalEnvironment: rawServer.experimentalEnvironment }
              : {}),
          },
        ];
      }),
    );
    const converted = convertToCodexFormat(mcpServersWithCodexFields);
    const filteredMcpServers = this.removeEmptyEntries(converted);

    for (const name of Object.keys(converted)) {
      if (!Object.hasOwn(filteredMcpServers, name)) {
        warnWithFallback(
          undefined,
          `MCP server "${name}" had no non-empty configuration and was dropped from the codex CLI config`,
        );
      }
    }

    // Preserve per-tool approval state (`[mcp_servers.<server>.tools.<tool>]`
    // `approval_mode` decisions) that Codex's CLI writes when the user approves
    // an MCP tool. rulesync does not model this nested `tools` table, so without
    // re-merging it here a regenerate would wipe the user's saved approvals and
    // re-introduce approval prompts (#1709). It is the only user/CLI-written
    // nested state Codex persists under a server that rulesync does not own.
    // rulesync never emits `tools` itself — the canonical `tools` array cannot
    // be represented in Codex's approval table and is dropped on generate — so
    // in practice the existing table is always carried over. The guard on
    // `"tools" in serverRecord` is kept so that a future rulesync-owned `tools`
    // value would win over the preserved table rather than be clobbered by it.
    const existingMcpServers = isRecord(configToml["mcp_servers"]) ? configToml["mcp_servers"] : {};
    const mergedMcpServers = Object.fromEntries(
      Object.entries(filteredMcpServers).map(([name, serverConfig]) => {
        const existingServer = isRecord(existingMcpServers[name])
          ? existingMcpServers[name]
          : undefined;
        const serverRecord = serverConfig as Record<string, unknown>;
        if (existingServer && isRecord(existingServer["tools"]) && !("tools" in serverRecord)) {
          return [name, { ...serverRecord, tools: existingServer["tools"] }];
        }
        return [name, serverConfig];
      }),
    );

    return new CodexcliMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent: configTomlFileContent,
        patch: { mcp_servers: mergedMcpServers },
        filePath: configTomlFilePath,
      }),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = (this.toml.mcp_servers ?? {}) as Record<string, unknown>;
    const converted = convertFromCodexFormat(mcpServers);

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: converted }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  private static removeEmptyEntries(
    obj: Record<string, unknown> | undefined,
    depth = 0,
  ): Record<string, unknown> {
    if (!obj) return {};
    if (depth > MAX_REMOVE_EMPTY_ENTRIES_DEPTH) {
      warnWithFallback(
        undefined,
        `removeEmptyEntries: maximum recursion depth (${MAX_REMOVE_EMPTY_ENTRIES_DEPTH}) exceeded; empty nested objects may remain`,
      );
      return obj;
    }

    const filtered: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      // Skip null values
      if (value === null) continue;

      // Recurse into nested plain objects so empty inner tables (e.g.
      // `env: {}`) are stripped too. Without this, smol-toml emits an
      // empty `[mcp_servers.X.env]` header, which codex CLI rejects for
      // remote (sse/http/streamable_http) transports with:
      //   "env is not supported for streamable_http"
      // Arrays are preserved verbatim — individual array elements are not
      // recursed into because an empty inline table like `[{}, "a"]` in
      // TOML differs from a table header `[mcp_servers.X.env]` that codex
      // CLI rejects. Only plain objects trigger the recursive strip.
      if (isPlainObject(value)) {
        const cleaned = this.removeEmptyEntries(value, depth + 1);
        if (Object.keys(cleaned).length === 0) continue;
        filtered[key] = cleaned;
        continue;
      }

      filtered[key] = value;
    }

    return filtered;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): CodexcliMcp {
    return new CodexcliMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
