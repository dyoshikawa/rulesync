import { join } from "node:path";

import * as smolToml from "smol-toml";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
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

function convertFromCodexFormat(codexMcp: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(codexMcp)) {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      continue;
    }

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (key === "enabled") {
        if (value === false) {
          converted["disabled"] = true;
        }
      } else if (key === "enabled_tools") {
        converted["enabledTools"] = value;
      } else if (key === "disabled_tools") {
        converted["disabledTools"] = value;
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

  for (const [name, config] of Object.entries(mcpServers)) {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (key === "disabled") {
        if (value === true) {
          converted["enabled"] = false;
        }
      } else if (key === "enabledTools") {
        converted["enabled_tools"] = value;
      } else if (key === "disabledTools") {
        converted["disabled_tools"] = value;
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
    // relative path. The difference is resolved by the baseDir passed to the processor.
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
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CodexcliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(join(baseDir, paths.relativeDirPath, paths.relativeFilePath))) ??
      smolToml.stringify({});

    return new CodexcliMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<CodexcliMcp> {
    const paths = this.getSettablePaths({ global });

    const configTomlFilePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const configTomlFileContent = await readOrInitializeFileContent(
      configTomlFilePath,
      smolToml.stringify({}),
    );

    const configToml = smolToml.parse(configTomlFileContent);

    const mcpServers = rulesyncMcp.getJson().mcpServers;
    const converted = convertToCodexFormat(mcpServers);
    const filteredMcpServers = this.removeEmptyEntries(converted);

    // eslint-disable-next-line no-type-assertion/no-type-assertion
    configToml["mcp_servers"] = filteredMcpServers as smolToml.TomlTable;

    return new CodexcliMcp({
      baseDir,
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

    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ mcpServers: converted }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  private static removeEmptyEntries(
    obj: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!obj) return {};

    const filtered: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip null values and empty objects
      if (value === null) continue;
      if (typeof value === "object" && Object.keys(value).length === 0) continue;

      filtered[key] = value;
    }

    return filtered;
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): CodexcliMcp {
    return new CodexcliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
