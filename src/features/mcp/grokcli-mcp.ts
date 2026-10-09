import { join } from "node:path";

import * as smolToml from "smol-toml";

import { GROKCLI_DIR, GROKCLI_MCP_FILE_NAME } from "../../constants/grokcli-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
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
 * Grok keeps per-server MCP tool deny lists in a top-level
 * `[disabled_mcp_tools]` table (`map<server, string[]>` of unqualified tool
 * names), not inside `[mcp_servers.<name>]`. Grok reads it from the user
 * `~/.grok/config.toml` only: a project `.grok/config.toml` contributes just
 * `[mcp_servers]`, `[plugins]`, `[permission]` and `[mcp] max_output_bytes`.
 * https://github.com/xai-org/grok-build/blob/2bdd1d6a/crates/codegen/xai-grok-pager/docs/user-guide/26-config-reference.md
 */
const GROK_DISABLED_MCP_TOOLS_KEY = "disabled_mcp_tools";

/**
 * Grok Build stores MCP servers in `config.toml` under a `[mcp_servers.<name>]`
 * table. Verified against `grok mcp add` (grok 0.2.54): a stdio server emits
 * `command`, `args`, `enabled = true`, and an `[mcp_servers.<name>.env]` table;
 * a remote server emits `url` and `enabled`. Unlike Codex CLI, Grok uses a
 * literal `env` table (not the `env_vars` passthrough list), so the only field
 * rename is `disabled` (rulesync) ↔ `enabled = false` (grok). `disabledTools`
 * never lands in the server table: it is lifted into the top-level
 * `[disabled_mcp_tools]` table by `buildDisabledMcpTools`.
 */
function convertToGrokFormat(mcpServers: McpServers): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (!isRecord(config)) continue;
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key) || key === "disabledTools") continue;
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

function toToolNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tool): tool is string => typeof tool === "string");
}

/**
 * Recompute the global `[disabled_mcp_tools]` table: every server Rulesync
 * declares gets its `disabledTools` (or loses a stale entry when it has none —
 * Grok itself removes an entry whose list empties), while entries for other
 * servers — ones toggled in Grok's `/mcps` UI, plugin or compat servers, and
 * the `__managed_gateway_connectors` sentinel — are carried over untouched.
 * Returns `undefined` when nothing is left, so the key is retracted.
 */
function buildDisabledMcpTools({
  mcpServers,
  existingContent,
  filePath,
}: {
  mcpServers: McpServers;
  existingContent: string;
  filePath: string;
}): Record<string, string[]> | undefined {
  const existing = parseSharedConfig({ format: "toml", fileContent: existingContent, filePath })[
    GROK_DISABLED_MCP_TOOLS_KEY
  ];
  const result: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    const tools = toToolNameList(config.disabledTools);
    if (tools.length > 0) {
      result[name] = tools;
    } else {
      delete result[name];
    }
  }

  return Object.keys(result).length > 0 ? (result as Record<string, string[]>) : undefined;
}

function warnProjectDisabledTools(mcpServers: McpServers, logger: Logger | undefined): void {
  const serverNames = Object.entries(mcpServers)
    .filter(([, config]) => isRecord(config) && config.disabledTools !== undefined)
    .map(([name]) => name);
  if (serverNames.length === 0) return;
  warnWithFallback(
    logger,
    `grokcli reads per-server \`disabledTools\` only from the user ~/.grok/config.toml ([disabled_mcp_tools]); dropping it from ${serverNames.join(", ")} in project mode. Generate with --global to apply it.`,
  );
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
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<GrokcliMcp> {
    const paths = this.getSettablePaths({ global });

    const configTomlFilePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const configTomlFileContent = (await readFileContentOrNull(configTomlFilePath)) ?? "";

    const strippedMcpServers = rulesyncMcp.getMcpServers();
    const converted = convertToGrokFormat(strippedMcpServers);
    const filteredMcpServers = this.removeEmptyEntries(converted);

    if (!global) {
      warnProjectDisabledTools(strippedMcpServers, logger);
    }

    for (const name of Object.keys(converted)) {
      if (!Object.hasOwn(filteredMcpServers, name)) {
        warnWithFallback(
          logger,
          `MCP server "${name}" had no non-empty configuration and was dropped from the grok CLI config`,
        );
      }
    }

    return new GrokcliMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent: configTomlFileContent,
        // With no server left the key is retracted rather than left as an
        // empty `[mcp_servers]` table, so the file states nothing Rulesync
        // no longer generates.
        patch: {
          mcp_servers: Object.keys(filteredMcpServers).length > 0 ? filteredMcpServers : undefined,
          // Only the user config is read for this key, so a project generate
          // leaves whatever the project file states alone.
          ...(global && {
            [GROK_DISABLED_MCP_TOOLS_KEY]: buildDisabledMcpTools({
              mcpServers: strippedMcpServers,
              existingContent: configTomlFileContent,
              filePath: configTomlFilePath,
            }),
          }),
        },
        filePath: configTomlFilePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = (this.toml.mcp_servers ?? {}) as Record<string, unknown>;
    const converted = convertFromGrokFormat(mcpServers);

    // Mirror of generate: the deny lists are read back in global mode only,
    // and only for servers this file declares (the managed-gateway sentinel
    // and entries for servers defined elsewhere have no server to attach to).
    const disabledMcpTools = this.toml[GROK_DISABLED_MCP_TOOLS_KEY];
    if (this.global && isRecord(disabledMcpTools)) {
      for (const [name, config] of Object.entries(converted)) {
        if (!Object.hasOwn(disabledMcpTools, name)) continue;
        const tools = toToolNameList(disabledMcpTools[name]);
        if (tools.length > 0) {
          converted[name] = { ...config, disabledTools: tools };
        }
      }
    }

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
