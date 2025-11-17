import { join } from "node:path";
import { omit } from "es-toolkit/object";
import { z } from "zod/mini";
import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../../types/tool-targets.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

const McpTransportTypeSchema = z.enum(["stdio", "sse", "http"]);

// Base schema: type, command, args are required; no description field
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

// Schema for rulesync MCP server (extends base schema with optional targets)
const RulesyncMcpServerSchema = z.union([
  z.extend(McpServerBaseSchema, {
    targets: z.optional(RulesyncTargetsSchema),
    description: z.optional(z.string()),
    exposed: z.optional(z.literal(false)),
  }),
  z.extend(McpServerBaseSchema, {
    targets: z.optional(RulesyncTargetsSchema),
    description: z.undefined(),
    exposed: z.literal(true),
  }),
]);

const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServerSchema),
});
type RulesyncMcpConfig = z.infer<typeof RulesyncMcpConfigSchema>;

export type RulesyncMcpParams = RulesyncFileParams & {
  modularMcp?: boolean;
};

export type RulesyncMcpFromFileParams = Pick<RulesyncFileFromFileParams, "validate"> & {
  modularMcp?: boolean;
};

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
  private readonly modularMcp: boolean;

  constructor({ modularMcp = false, ...rest }: RulesyncMcpParams) {
    super({ ...rest });

    this.json = JSON.parse(this.fileContent);
    this.modularMcp = modularMcp;

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
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json",
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
      },
    };
  }

  validate(): ValidationResult {
    const result = RulesyncMcpConfigSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static async fromFile({
    validate = true,
    modularMcp = false,
  }: RulesyncMcpFromFileParams): Promise<RulesyncMcp> {
    const baseDir = process.cwd();
    const paths = this.getSettablePaths();
    const recommendedPath = join(
      baseDir,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    );
    const legacyPath = join(baseDir, paths.legacy.relativeDirPath, paths.legacy.relativeFilePath);

    // Check if recommended path exists
    if (await fileExists(recommendedPath)) {
      const fileContent = await readFileContent(recommendedPath);
      return new RulesyncMcp({
        baseDir,
        relativeDirPath: paths.recommended.relativeDirPath,
        relativeFilePath: paths.recommended.relativeFilePath,
        fileContent,
        validate,
        modularMcp,
      });
    }

    // Fall back to legacy path
    if (await fileExists(legacyPath)) {
      logger.warn(
        `⚠️  Using deprecated path "${legacyPath}". Please migrate to "${recommendedPath}"`,
      );
      const fileContent = await readFileContent(legacyPath);
      return new RulesyncMcp({
        baseDir,
        relativeDirPath: paths.legacy.relativeDirPath,
        relativeFilePath: paths.legacy.relativeFilePath,
        fileContent,
        validate,
        modularMcp,
      });
    }

    // If neither exists, try to read recommended path (will throw appropriate error)
    const fileContent = await readFileContent(recommendedPath);
    return new RulesyncMcp({
      baseDir,
      relativeDirPath: paths.recommended.relativeDirPath,
      relativeFilePath: paths.recommended.relativeFilePath,
      fileContent,
      validate,
      modularMcp,
    });
  }

  getExposedServers(): Record<string, unknown> {
    // Return only servers with exposed: true, omitting description and exposed fields
    return Object.fromEntries(
      Object.entries(this.json.mcpServers)
        .filter(([, serverConfig]) => serverConfig.exposed)
        .map(([serverName, serverConfig]) => [
          serverName,
          omit(serverConfig, ["description", "exposed"]),
        ]),
    );
  }

  getModularizedServers(): Record<string, unknown> {
    // Return only servers with exposed: false, omitting description and exposed fields
    return Object.fromEntries(
      Object.entries(this.json.mcpServers)
        .filter(([, serverConfig]) => !serverConfig.exposed)
        .map(([serverName, serverConfig]) => [
          serverName,
          omit(serverConfig, ["description", "exposed"]),
        ]),
    );
  }

  getJson(): RulesyncMcpConfig {
    return this.json;
  }
}
