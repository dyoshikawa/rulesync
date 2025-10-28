import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readOrInitializeFileContent } from "../utils/file.js";
import { ModularMcp } from "./modular-mcp.js";
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

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: ".claude",
        relativeFilePath: ".claude.json",
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json",
    };
  }

  static async fromFile({
    baseDir = ".",
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ClaudecodeMcp> {
    const paths = this.getSettablePaths({ global });
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
    modularMcp = false,
  }: ToolMcpFromRulesyncMcpParams & { modularMcp?: boolean }): Promise<ClaudecodeMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);

    // Generate .mcp.json with modular-mcp proxy or actual server configurations
    const mcpJson = modularMcp
      ? {
          ...json,
          mcpServers: global
            ? ModularMcp.getMcpServers({ baseDir, global: true, relativeDirPath: ".claude" })
            : ModularMcp.getMcpServers({ baseDir, global: false }),
        }
      : { ...json, mcpServers: rulesyncMcp.getJson({ modularMcp: false }).mcpServers };

    return new ClaudecodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mcpJson, null, 2),
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
