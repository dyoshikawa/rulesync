import { join } from "node:path";
import { omit } from "es-toolkit/object";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { fileExists, readFileContent } from "../utils/file.js";
import { logger } from "../utils/logger.js";

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

// Schema for modular-mcp: extends base schema with required description field
const ModularMcpServerSchema = z.extend(McpServerBaseSchema, {
  description: z.string().check(z.minLength(1)),
});

// Schema for modular-mcp servers validation (validates description exists)
const ModularMcpServersSchema = z.record(z.string(), ModularMcpServerSchema);

// Schema for rulesync MCP servers (extends base schema with optional targets)
const RulesyncMcpServersSchema = z.extend(McpServerBaseSchema, {
  description: z.optional(z.string()),
  targets: z.optional(RulesyncTargetsSchema),
});

const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServersSchema),
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
    if (this.modularMcp) {
      const result = ModularMcpServersSchema.safeParse(this.json.mcpServers);
      if (!result.success) {
        return {
          success: false,
          error: new Error(
            `Invalid MCP server configuration for modular-mcp: ${formatError(result.error)}`,
          ),
        };
      }
    }
    return { success: true, error: null };
  }

  static async fromFile({
    validate = true,
    modularMcp = false,
  }: RulesyncMcpFromFileParams): Promise<RulesyncMcp> {
    const paths = this.getSettablePaths();
    const recommendedPath = join(
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    );
    const legacyPath = join(paths.legacy.relativeDirPath, paths.legacy.relativeFilePath);

    // Check if recommended path exists
    if (await fileExists(recommendedPath)) {
      const fileContent = await readFileContent(recommendedPath);
      return new RulesyncMcp({
        baseDir: ".",
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
        baseDir: ".",
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
      baseDir: ".",
      relativeDirPath: paths.recommended.relativeDirPath,
      relativeFilePath: paths.recommended.relativeFilePath,
      fileContent,
      validate,
      modularMcp,
    });
  }

  getJson({ modularMcp = false }: { modularMcp?: boolean } = {}): RulesyncMcpConfig {
    if (modularMcp) {
      return this.json;
    }

    // If json is not an object or null, return as is
    if (!this.json || typeof this.json !== "object") {
      return this.json;
    }

    // If mcpServers doesn't exist or is not an object, return as is
    if (!this.json.mcpServers || typeof this.json.mcpServers !== "object") {
      return this.json;
    }

    // When modularMcp is false, omit description fields from all servers
    const mcpServersWithoutDescription = Object.fromEntries(
      Object.entries(this.json.mcpServers).map(([serverName, serverConfig]) => [
        serverName,
        omit(serverConfig, ["description"]),
      ]),
    );

    return {
      ...this.json,
      mcpServers: mcpServersWithoutDescription,
    };
  }
}
