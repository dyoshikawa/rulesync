import { join } from "node:path";
import { z } from "zod/mini";
import { AiFile, AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

// Schema for modular-mcp.json server configuration
const ModularMcpServerSchema = z.object({
  type: z.optional(z.enum(["stdio", "sse", "http"])),
  command: z.optional(z.union([z.string(), z.array(z.string())])),
  args: z.optional(z.array(z.string())),
  url: z.optional(z.string()),
  httpUrl: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  disabled: z.optional(z.boolean()),
  networkTimeout: z.optional(z.number()),
  timeout: z.optional(z.number()),
  trust: z.optional(z.boolean()),
  cwd: z.optional(z.string()),
  transport: z.optional(z.enum(["stdio", "sse", "http"])),
  alwaysAllow: z.optional(z.array(z.string())),
  tools: z.optional(z.array(z.string())),
  kiroAutoApprove: z.optional(z.array(z.string())),
  kiroAutoBlock: z.optional(z.array(z.string())),
  headers: z.optional(z.record(z.string(), z.string())),
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
    try {
      // Only validate structure if json is an object with mcpServers property
      if (typeof this.json === "object" && this.json !== null && "mcpServers" in this.json) {
        // Validate the JSON structure
        ModularMcpConfigSchema.parse(this.json);
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
