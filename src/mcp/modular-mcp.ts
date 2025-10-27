import { join } from "node:path";
import { AiFile, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

export type ModularMcpParams = AiFileParams;

export type ModularMcpFromRulesyncMcpParams = {
  baseDir?: string;
  rulesyncMcp: RulesyncMcp;
  validate?: boolean;
};

export type ModularMcpSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class ModularMcp extends AiFile {
  private readonly json: Record<string, unknown>;

  constructor(params: ModularMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(): ModularMcpSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: "modular-mcp.json",
    };
  }

  static getMcpServers(): Record<string, unknown> {
    return {
      "modular-mcp": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@kimuson/modular-mcp", "modular-mcp.json"],
        env: {},
      },
    };
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
  }: ModularMcpFromRulesyncMcpParams): ModularMcp {
    const paths = this.getSettablePaths();

    // Generate modular-mcp.json with actual server configurations
    const modularMcpJson = {
      mcpServers: rulesyncMcp.getJson({ modularMcp: true }).mcpServers,
    };

    return new ModularMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(modularMcpJson, null, 2),
      validate,
    });
  }

  getAbsolutePath(): string {
    const paths = ModularMcp.getSettablePaths();
    return join(this.baseDir, paths.relativeDirPath, paths.relativeFilePath);
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
