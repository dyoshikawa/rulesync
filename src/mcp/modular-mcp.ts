import { join } from "node:path";
import { AiFile, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

export type ModularMcpParams = AiFileParams;

export type ModularMcpFromRulesyncMcpParams = {
  baseDir?: string;
  rulesyncMcp: RulesyncMcp;
  validate?: boolean;
} & (
  | { global?: false | undefined; relativeDirPath?: undefined }
  | { global: true; relativeDirPath: string }
);

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

  static getSettablePaths(
    params:
      | { global: false; relativeDirPath?: undefined }
      | { global: true; relativeDirPath: string } = {
      global: false,
      relativeDirPath: undefined,
    },
  ): ModularMcpSettablePaths {
    const relativeFilePath = "modular-mcp.json";
    if (!params.global) {
      return {
        relativeDirPath: ".",
        relativeFilePath,
      };
    }

    return {
      relativeDirPath: params.relativeDirPath,
      relativeFilePath,
    };
  }

  static getMcpServers(
    {
      baseDir,
      global,
      relativeDirPath,
    }:
      | { baseDir: string; global: false; relativeDirPath?: undefined }
      | { baseDir: string; global: true; relativeDirPath: string } = {
      baseDir: ".",
      global: false,
      relativeDirPath: undefined,
    },
  ): Record<string, unknown> {
    const paths = this.getSettablePaths(
      global ? { global: true, relativeDirPath } : { global: false, relativeDirPath: undefined },
    );

    if (!global) {
      return {
        "modular-mcp": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@kimuson/modular-mcp", paths.relativeFilePath],
          env: {},
        },
      };
    }

    return {
      "modular-mcp": {
        type: "stdio",
        command: "npx",
        args: [
          "-y",
          "@kimuson/modular-mcp",
          join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
        ],
        env: {},
      },
    };
  }

  static fromRulesyncMcp({
    baseDir = ".",
    rulesyncMcp,
    validate = true,
    global = false,
    relativeDirPath,
  }: ModularMcpFromRulesyncMcpParams): ModularMcp {
    const paths = this.getSettablePaths(
      global && relativeDirPath
        ? { global: true, relativeDirPath }
        : { global: false, relativeDirPath: undefined },
    );

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

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
