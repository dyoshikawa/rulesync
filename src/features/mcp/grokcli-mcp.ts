import { join } from "node:path";

import * as smolToml from "smol-toml";

import { GROKCLI_DIR, GROKCLI_MCP_FILE_NAME } from "../../constants/grokcli-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  type ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const MAX_REMOVE_EMPTY_ENTRIES_DEPTH = 32;

/**
 * Grok Build stores MCP servers in `config.toml` under a `[mcp_servers.<name>]`
 * table. Verified against `grok mcp add` (grok 0.2.54): a stdio server emits
 * `command`, `args`, `enabled = true`, and an `[mcp_servers.<name>.env]` table;
 * a remote server emits `url` and `enabled`. Unlike Codex CLI, Grok uses a
 * literal `env` table (not the `env_vars` passthrough list) and has no
 * per-server tool allow/deny lists, so the only field rename is
 * `disabled` (rulesync) ↔ `enabled = false` (grok).
 */
function convertToGrokFormat(mcpServers: McpServers): Record<string, unknown> {
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
      } else {
        converted[key] = value;
      }
    }
    result[name] = converted;
  }

  return result;
}

function convertFromGrokFormat(grokMcp: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(grokMcp)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "enabled") {
        if (value === false) {
          converted["disabled"] = true;
        }
      } else {
        converted[key] = value;
      }
    }

    result[name] = converted;
  }

  return result;
}

export class GrokcliMcp extends ToolMcp {
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
    // Both global (~/.grok/config.toml) and project (.grok/config.toml) use the
    // same relative path; the difference is resolved by the outputRoot passed to
    // the processor.
    return {
      relativeDirPath: GROKCLI_DIR,
      relativeFilePath: GROKCLI_MCP_FILE_NAME,
    };
  }

  /**
   * config.toml may contain other Grok settings, so it should not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<GrokcliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? smolToml.stringify({});

    return new GrokcliMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<GrokcliMcp> {
    const paths = this.getSettablePaths({ global });

    const configTomlFilePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const configTomlFileContent = await readOrInitializeFileContent(
      configTomlFilePath,
      smolToml.stringify({}),
    );

    const configToml = smolToml.parse(configTomlFileContent);

    const strippedMcpServers = rulesyncMcp.getMcpServers();
    const converted = convertToGrokFormat(strippedMcpServers);
    const filteredMcpServers = this.removeEmptyEntries(converted);

    for (const name of Object.keys(converted)) {
      if (!Object.hasOwn(filteredMcpServers, name)) {
        warnWithFallback(
          undefined,
          `MCP server "${name}" had no non-empty configuration and was dropped from the grok CLI config`,
        );
      }
    }

    configToml["mcp_servers"] = filteredMcpServers as smolToml.TomlTable;

    return new GrokcliMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(configToml),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = (this.toml.mcp_servers ?? {}) as Record<string, unknown>;
    const converted = convertFromGrokFormat(mcpServers);

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
      // `env: {}`) are stripped too. Without this, smol-toml emits an empty
      // `[mcp_servers.X.env]` header for servers with no env vars.
      // Arrays are preserved verbatim.
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
  }: ToolMcpForDeletionParams): GrokcliMcp {
    return new GrokcliMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
