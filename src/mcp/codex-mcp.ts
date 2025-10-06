import { join } from "node:path";
import * as toml from "smol-toml";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent, readOrInitializeFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export class CodexcliMcp extends ToolMcp {
  static getSettablePaths(): ToolMcpSettablePaths {
    throw new Error("getSettablePaths is not supported for CodexcliMcp");
  }

  static getSettablePathsGlobal(): ToolMcpSettablePaths {
    return {
      relativeDirPath: join(".codex", "config.toml"),
      relativeFilePath: "",
    };
  }

  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolMcpFromFileParams): Promise<CodexcliMcp> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new CodexcliMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
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
    rulesyncMcp.getJson();
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
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: toml.stringify(configToml),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
