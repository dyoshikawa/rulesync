import { join } from "node:path";

import * as smolToml from "smol-toml";

import { CODEXCLI_DIR, CODEXCLI_MCP_FILE_NAME } from "../../constants/codexcli-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
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

const MAX_REMOVE_EMPTY_ENTRIES_DEPTH = 32;

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

function normalizeCodexMcpServerName(name: string): string | null {
  if (PROTOTYPE_POLLUTION_KEYS.has(name)) return null;
  if (CODEX_MCP_SERVER_NAME_PATTERN.test(name)) return name;

  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalizedName && !PROTOTYPE_POLLUTION_KEYS.has(normalizedName) ? normalizedName : null;
}

function convertFromCodexFormat(codexMcp: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(codexMcp)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "enabled") {
        if (value === false) {
          converted["disabled"] = true;
        }
      } else if (key === "oauth" && isRecord(value)) {
        converted[key] = mapOauthFromCodex(value);
      } else if (Object.hasOwn(CODEX_TO_RULESYNC_FIELD_MAP, key)) {
        const mappedKey = CODEX_TO_RULESYNC_FIELD_MAP[key];
        if (mappedKey) {
          if (isStringArray(value)) {
            converted[mappedKey] = value;
          } else {
            warnWithFallback(undefined, `Ignored malformed array for ${key} in MCP server ${name}`);
          }
        }
      } else {
        converted[key] = value;
      }
    }

    result[name] = converted;
  }

  return result;
}

function convertToCodexFormat(mcpServers: McpServers): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};
  const originalNames = new Map<string, string>();

  for (const [name, config] of Object.entries(mcpServers)) {
    const codexName = normalizeCodexMcpServerName(name);
    if (codexName === null) {
      warnWithFallback(
        undefined,
        `MCP server "${name}" could not be normalized to a valid Codex MCP server name and was skipped.`,
      );
      continue;
    }
    if (!isRecord(config)) continue;
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "disabled") {
        if (value === true) {
          converted["enabled"] = false;
        }
      } else if (key === "oauth" && isRecord(value)) {
        converted[key] = mapOauthToCodex(value);
      } else if (Object.hasOwn(RULESYNC_TO_CODEX_FIELD_MAP, key)) {
        const mappedKey = RULESYNC_TO_CODEX_FIELD_MAP[key];
        if (mappedKey) {
          if (isStringArray(value)) {
            converted[mappedKey] = value;
          } else {
            warnWithFallback(
              undefined,
              `[CodexCliMcp] Skipping invalid value type for mapped key '${key}': expected string array, got ${typeof value}`,
            );
          }
        }
      } else {
        converted[key] = value;
      }
    }

    const previousName = originalNames.get(codexName);
    if (previousName !== undefined) {
      warnWithFallback(
        undefined,
        `Codex MCP server name collision: "${previousName}" and "${name}" both normalize to "${codexName}". Only the last processed server will be used.`,
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
    const rawMcpServers = rulesyncMcp.getJson().mcpServers;
    const mcpServersWithCodexFields = Object.fromEntries(
      Object.entries(strippedMcpServers).map(([serverName, serverConfig]) => {
        const rawServer = isRecord(rawMcpServers) ? rawMcpServers[serverName] : undefined;
        return [
          serverName,
          {
            ...serverConfig,
            // Only envVars needs manual re-merging here. Other codex-specific fields
            // (like disabledTools) are preserved by RulesyncMcp's filtering natively.
            ...(isRecord(rawServer) && isStringArray(rawServer.envVars)
              ? { envVars: rawServer.envVars }
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
    // rulesync still fully owns every field it does emit, including `tools` when
    // it is supplied as a rulesync value: the existing table is only restored
    // when rulesync emits no `tools` key at all, so a rulesync-owned `tools`
    // (e.g. an array) is never clobbered by the preserved approval table.
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
