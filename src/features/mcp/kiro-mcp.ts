import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readOrInitializeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export class KiroMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return {
      relativeDirPath: join(".kiro", "settings"),
      relativeFilePath: "mcp.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<KiroMcp> {
    const paths = this.getSettablePaths();
    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );

    return new KiroMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): KiroMcp {
    const paths = this.getSettablePaths();
    const fileContent = JSON.stringify({ mcpServers: rulesyncMcp.getMcpServers() }, null, 2);

    return new KiroMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers ?? {} }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): KiroMcp {
    return new KiroMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
