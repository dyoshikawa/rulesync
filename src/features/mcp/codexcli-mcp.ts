import { join } from "node:path";

import * as smolToml from "smol-toml";

import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import { isPlainObject, isRecord, isStringArray } from "../../utils/type-guards.js";
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

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

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
      } else if (key in CODEX_TO_RULESYNC_FIELD_MAP) {
        const mappedKey = CODEX_TO_RULESYNC_FIELD_MAP[key];
        if (mappedKey && isStringArray(value)) {
          converted[mappedKey] = value;
        }
      } else {
        converted[key] = value;
      }
    }

    result[name] = converted;
  }

  return result;
}

function convertToCodexFormat(
  mcpServers: McpServers,
  logger?: import("../../utils/logger.js").Logger,
): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (!isRecord(config)) continue;
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "disabled") {
        if (value === true) {
          converted["enabled"] = false;
        }
      } else if (key in RULESYNC_TO_CODEX_FIELD_MAP) {
        const mappedKey = RULESYNC_TO_CODEX_FIELD_MAP[key];
        if (mappedKey) {
          if (isStringArray(value)) {
            converted[mappedKey] = value;
          } else {
            warnWithFallback(
              logger,
              `[CodexCliMcp] Skipping invalid value type for mapped key '${key}': expected string array, got ${typeof value}`,
            );
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

export class CodexcliMcp extends ToolMcp {
  private readonly toml: smolToml.TomlTable;

  constructor({ ...rest }: ToolMcpParams) {
    super({
      ...rest,
      validate: false,
    });

    this.toml = smolToml.parse(this.fileContent);

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
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
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
    const configTomlFileContent = await readOrInitializeFileContent(
      configTomlFilePath,
      smolToml.stringify({}),
    );

    const configToml = smolToml.parse(configTomlFileContent);

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
    const converted = convertToCodexFormat(mcpServersWithCodexFields, undefined);
    const filteredMcpServers = this.removeEmptyEntries(converted);

    for (const name of Object.keys(converted)) {
      if (!Object.hasOwn(filteredMcpServers, name)) {
        warnWithFallback(
          undefined,
          `MCP server "${name}" had no non-empty configuration and was dropped from the codex CLI config`,
        );
      }
    }

    // eslint-disable-next-line no-type-assertion/no-type-assertion
    configToml["mcp_servers"] = filteredMcpServers as smolToml.TomlTable;

    return new CodexcliMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(configToml),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    // eslint-disable-next-line no-type-assertion/no-type-assertion
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
