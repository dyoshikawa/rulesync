import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readOrInitializeFileContent } from "../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export class ClaudecodeMcp extends ToolMcp {
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
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
    };
  }

  static getSettablePathsGlobal(): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".claude",
      relativeFilePath: ".claude.json",
    };
  }

  static async fromFile({
    baseDir = ".",
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ClaudecodeMcp> {
    const paths = global ? this.getSettablePathsGlobal() : this.getSettablePaths();
    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new ClaudecodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<ClaudecodeMcp> {
    const paths = global ? this.getSettablePathsGlobal() : this.getSettablePaths();

    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }),
    );
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: rulesyncMcp.getJson().mcpServers };

    return new ClaudecodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
