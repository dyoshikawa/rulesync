import { join } from "node:path";

import * as smolToml from "smol-toml";

import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
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
const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPrototypePollutionKey(key: string): boolean {
  return PROTOTYPE_POLLUTION_KEYS.has(key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function convertFromCodexFormat(codexMcp: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(codexMcp)) {
    if (isPrototypePollutionKey(name) || !isPlainRecord(config)) {
      continue;
    }

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (isPrototypePollutionKey(key)) continue;

      if (key === "enabled") {
        if (value === false) {
          converted["disabled"] = true;
        }
      } else if (key === "enabled_tools") {
        converted["enabledTools"] = value;
      } else if (key === "disabled_tools") {
        converted["disabledTools"] = value;
      } else if (key === "env_vars") {
        // codex stores env-var passthrough names in snake_case (`env_vars`);
        // the rulesync source schema uses camelCase (`envVars`) for
        // consistency with `enabledTools`/`disabledTools`/etc.
        converted["envVars"] = value;
      } else {
        converted[key] = value;
      }
    }

    result[name] = converted;
  }

  return result;
}

function convertToCodexFormat(mcpServers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (isPrototypePollutionKey(name) || !isPlainRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (isPrototypePollutionKey(key)) continue;

      if (key === "disabled") {
        if (value === true) {
          converted["enabled"] = false;
        }
      } else if (key === "enabledTools") {
        converted["enabled_tools"] = value;
      } else if (key === "disabledTools") {
        converted["disabled_tools"] = value;
      } else if (key === "envVars") {
        // Rename camelCase source `envVars` → snake_case `env_vars`
        // for codex's native config.toml format. See `enabledTools`
        // precedent above. `envVars` itself is stripped from
        // getMcpServers() so non-codex tools never receive it.
        converted["env_vars"] = value;
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

    const rulesyncMcpServers = rulesyncMcp.getJson().mcpServers;
    const converted = convertToCodexFormat(
      isPlainRecord(rulesyncMcpServers) ? rulesyncMcpServers : {},
    );
    const filteredMcpServers = this.removeEmptyEntries(converted);

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

    const filtered: Record<string, unknown> = {};

    if (depth >= MAX_REMOVE_EMPTY_ENTRIES_DEPTH) {
      for (const [key, value] of Object.entries(obj)) {
        if (isPrototypePollutionKey(key) || value === null) continue;
        filtered[key] = value;
      }
      return filtered;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (isPrototypePollutionKey(key)) continue;

      // Skip null values
      if (value === null) continue;

      // Recurse into nested plain objects so empty inner tables (e.g.
      // `env: {}`) are stripped too. Without this, smol-toml emits an
      // empty `[mcp_servers.X.env]` header, which codex CLI rejects for
      // remote (sse/http/streamable_http) transports with:
      //   "env is not supported for streamable_http"
      // Arrays are preserved verbatim, including empty ones, since an
      // empty array can be a meaningful explicit override. Array elements
      // are not recursed into.
      if (isPlainRecord(value)) {
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
