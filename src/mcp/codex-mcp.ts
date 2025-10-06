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
      smolToml.stringify({}),
    );

    const configToml = smolToml.parse(configTomlFileContent);
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    configToml["mcpServers"] = rulesyncMcp.getJson().mcpServers as smolToml.TomlTable;

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
      fileContent: JSON.stringify(this.toml),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
