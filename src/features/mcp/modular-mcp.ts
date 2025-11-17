import { join } from "node:path";
import { z } from "zod/mini";
import { AiFile, AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { McpServerSchema } from "../../types/mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

// Schema for modular-mcp.json server configuration - based on McpServerSchema with required description
const ModularMcpServerSchema = z.extend(McpServerSchema, {
  description: z.string(), // Required for modular-mcp
});

const ModularMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), ModularMcpServerSchema),
});

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
      baseDir: process.cwd(),
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
    baseDir = process.cwd(),
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

    const modularMcpJson = {
      mcpServers: rulesyncMcp.getModularizedServers(),
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
    const result = ModularMcpConfigSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }
}
