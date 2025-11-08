import { join } from "node:path";
import * as smolToml from "smol-toml";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent, readOrInitializeFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  type ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

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

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (!global) {
      throw new Error("CodexcliMcp only supports global mode. Please pass { global: true }.");
    }
    return {
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CodexcliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
    );

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

    const mcpServers = rulesyncMcp.getJson({ modularMcp: false }).mcpServers;
    const filteredMcpServers = this.removeEmptyEntries(mcpServers);

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
    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ mcpServers: this.toml.mcp_servers ?? {} }, null, 2),
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
}
