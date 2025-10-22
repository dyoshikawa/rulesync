import { existsSync } from "node:fs";
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
import { logger } from "../utils/logger.js";

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

const RulesyncMcpServersSchema = z.extend(McpServerBaseSchema, {
  targets: z.optional(RulesyncTargetsSchema),
});

const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServersSchema),
});
type RulesyncMcpConfig = z.infer<typeof RulesyncMcpConfigSchema>;

export type RulesyncMcpParams = RulesyncFileParams;

export type RulesyncMcpFromFileParams = Pick<RulesyncFileFromFileParams, "validate">;

export type RulesyncMcpSettablePaths = {
  recommended: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  legacy: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export class RulesyncMcp extends RulesyncFile {
  private readonly json: RulesyncMcpConfig;

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
      recommended: {
        relativeDirPath: ".rulesync",
        relativeFilePath: "mcp.json",
      },
      legacy: {
        relativeDirPath: ".rulesync",
        relativeFilePath: ".mcp.json",
      },
    };
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFile({ validate = true }: RulesyncMcpFromFileParams): Promise<RulesyncMcp> {
    const paths = this.getSettablePaths();
    const recommendedPath = join(
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    );
    const legacyPath = join(paths.legacy.relativeDirPath, paths.legacy.relativeFilePath);

    // Check if recommended path exists
    if (existsSync(recommendedPath)) {
      const fileContent = await readFileContent(recommendedPath);
      return new RulesyncMcp({
        baseDir: ".",
        relativeDirPath: paths.recommended.relativeDirPath,
        relativeFilePath: paths.recommended.relativeFilePath,
        fileContent,
        validate,
      });
    }

    // Fall back to legacy path
    if (existsSync(legacyPath)) {
      logger.warn(
        `⚠️  Using deprecated path "${legacyPath}". Please migrate to "${recommendedPath}"`,
      );
      const fileContent = await readFileContent(legacyPath);
      return new RulesyncMcp({
        baseDir: ".",
        relativeDirPath: paths.legacy.relativeDirPath,
        relativeFilePath: paths.legacy.relativeFilePath,
        fileContent,
        validate,
      });
    }

    // If neither exists, try to read recommended path (will throw appropriate error)
    const fileContent = await readFileContent(recommendedPath);
    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: paths.recommended.relativeDirPath,
      relativeFilePath: paths.recommended.relativeFilePath,
      fileContent,
      validate,
    });
  }

  getJson(): RulesyncMcpConfig {
    return this.json;
  }
}
