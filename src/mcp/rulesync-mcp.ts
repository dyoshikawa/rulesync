import { join } from "node:path";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";
import { readFileContent } from "../utils/file.js";

const McpTransportTypeSchema = z.enum(["stdio", "sse", "http"]);
const McpServerBaseSchema = z.object({
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
  transport: z.optional(McpTransportTypeSchema),
  alwaysAllow: z.optional(z.array(z.string())),
  tools: z.optional(z.array(z.string())),
  kiroAutoApprove: z.optional(z.array(z.string())),
  kiroAutoBlock: z.optional(z.array(z.string())),
  headers: z.optional(z.record(z.string(), z.string())),
});

const RulesyncMcpServerSchema = z.extend(McpServerBaseSchema, {
  targets: z.optional(RulesyncTargetsSchema),
});

const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServerSchema),
});

export type RulesyncMcpParams = RulesyncFileParams;

// Re-export schema for validation consistency
export { RulesyncMcpConfigSchema as RulesyncMcpJsonSchema };

export type RulesyncMcpFromFileParams = Pick<RulesyncFileFromFileParams, "validate">;

export type RulesyncMcpSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncMcp extends RulesyncFile {
  private readonly json: Record<string, unknown>;

  constructor({ ...rest }: RulesyncMcpParams) {
    super({ ...rest });

    this.json = JSON.parse(this.fileContent);

    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncMcpSettablePaths {
    return {
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
    };
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFile({ validate = true }: RulesyncMcpFromFileParams): Promise<RulesyncMcp> {
    const fileContent = await readFileContent(
      join(this.getSettablePaths().relativeDirPath, this.getSettablePaths().relativeFilePath),
    );

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }
}
