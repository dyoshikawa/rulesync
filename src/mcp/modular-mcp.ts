import { join } from "node:path";
import { AiFile, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

export type ModularMcpParams = AiFileParams;

export type ModularMcpFromRulesyncMcpParams = {
  baseDir?: string;
  rulesyncMcp: RulesyncMcp;
  validate?: boolean;
  global?: boolean;
  toolTarget?: ToolTarget;
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

  static getSettablePaths(
    params: { global: false; toolTarget?: undefined } | { global: true; toolTarget: ToolTarget } = {
      global: false,
      toolTarget: undefined,
    },
  ): ModularMcpSettablePaths {
    const relativeFilePath = "modular-mcp.json";
    if (!params.global) {
      return {
        relativeDirPath: ".",
        relativeFilePath,
      };
    }

    // Global mode: return tool-specific paths
    switch (params.toolTarget) {
      case "claudecode":
        return {
          relativeDirPath: ClaudecodeMcp.getSettablePaths({ global: true }).relativeDirPath,
          relativeFilePath,
        };
      default:
        throw new Error(
          `Global mode for tool target "${params.toolTarget}" is not yet supported for modular-mcp`,
        );
    }
  }

  static getMcpServers(
    {
      baseDir = ".",
      global,
      toolTarget,
    }:
      | { baseDir: string; global: false; toolTarget?: undefined }
      | { baseDir: string; global: true; toolTarget: ToolTarget } = {
      baseDir: ".",
      global: false,
      toolTarget: undefined,
    },
  ): Record<string, unknown> {
    const paths = this.getSettablePaths(
      global ? { global: true, toolTarget } : { global: false, toolTarget: undefined },
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
    toolTarget,
  }: ModularMcpFromRulesyncMcpParams): ModularMcp {
    if (global && !toolTarget) {
      throw new Error("toolTarget is required when global is true");
    }

    const paths = (() => {
      if (global && toolTarget) {
        return this.getSettablePaths({ global: true, toolTarget });
      }
      return this.getSettablePaths({ global: false, toolTarget: undefined });
    })();

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
