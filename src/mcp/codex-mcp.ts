/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from "node:path";
import * as toml from "smol-toml";
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
  constructor({ fileContent, ...rest }: ToolMcpParams) {
    // Temporarily store the actual TOML file content
    const actualFileContent = fileContent;

    // Call parent constructor with empty JSON to avoid parsing error
    super({
      ...rest,
      fileContent: "{}",
      validate: false,
    });

    // Restore the actual TOML file content
    // biome-ignore lint/suspicious/noExplicitAny: Required to override parent property
    // @ts-expect-error - Need to override parent property with TOML content
    (this as any).fileContent = actualFileContent;

    // Parse TOML and override the json property
    // biome-ignore lint/suspicious/noExplicitAny: Required to override parent property
    // @ts-expect-error - Need to override parent property with parsed TOML
    (this as any).json = toml.parse(actualFileContent);

    // Validate after setting patterns, if validation was requested
    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    throw new Error("getSettablePaths is not supported for CodexcliMcp");
  }

  static getSettablePathsGlobal(): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
    };
  }

  static async fromFile({
    baseDir = ".",
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CodexcliMcp> {
    const paths = global ? this.getSettablePathsGlobal() : this.getSettablePaths();
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
    baseDir = ".",
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<CodexcliMcp> {
    const paths = global ? this.getSettablePathsGlobal() : this.getSettablePaths();

    const configTomlFilePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const configTomlFileContent = await readOrInitializeFileContent(
      configTomlFilePath,
      toml.stringify({}),
    );

    const configToml = toml.parse(configTomlFileContent);
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    configToml["mcpServers"] = rulesyncMcp.getJson().mcpServers as toml.TomlTable;

    return new CodexcliMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: toml.stringify(configToml),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    // Convert only mcpServers from TOML json to JSON string
    const mcpServersOnly = this.json.mcpServers ? { mcpServers: this.json.mcpServers } : {};

    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify(mcpServersOnly),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
