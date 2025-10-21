import { join } from "node:path";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";
import { fileExists, readFileContent } from "../utils/file.js";
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
  relativeDirPath: string;
  relativeFilePath: string;
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
      relativeDirPath: ".rulesync",
      relativeFilePath: "mcp.json",
    };
  }

  static getLegacySettablePaths(): RulesyncMcpSettablePaths {
    return {
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
    };
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFile({ validate = true }: RulesyncMcpFromFileParams): Promise<RulesyncMcp> {
    const newPath = join(
      this.getSettablePaths().relativeDirPath,
      this.getSettablePaths().relativeFilePath,
    );
    const legacyPath = join(
      this.getLegacySettablePaths().relativeDirPath,
      this.getLegacySettablePaths().relativeFilePath,
    );

    // Check if new path exists
    const newPathExists = await fileExists(newPath);
    const legacyPathExists = await fileExists(legacyPath);

    let fileContent: string;
    let usedPath: RulesyncMcpSettablePaths;

    if (newPathExists) {
      // Prefer new path if it exists
      fileContent = await readFileContent(newPath);
      usedPath = this.getSettablePaths();
    } else if (legacyPathExists) {
      // Fall back to legacy path
      logger.warn(
        `Using deprecated path '${legacyPath}'. Please rename to '${newPath}'. ` +
          `The '${legacyPath}' path will be removed in a future version.`,
      );
      fileContent = await readFileContent(legacyPath);
      usedPath = this.getLegacySettablePaths();
    } else {
      // Neither path exists, try to read new path and let it fail with appropriate error
      fileContent = await readFileContent(newPath);
      usedPath = this.getSettablePaths();
    }

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: usedPath.relativeDirPath,
      relativeFilePath: usedPath.relativeFilePath,
      fileContent,
      validate,
    });
  }

  getJson(): RulesyncMcpConfig {
    return this.json;
  }
}
