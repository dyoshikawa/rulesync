import { omit } from "es-toolkit/object";
import { join } from "node:path";
import { z } from "zod/mini";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServerSchema, McpServers } from "../../types/mcp.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema } from "../../types/tool-targets.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

// Schema for rulesync MCP server (extends base schema with optional targets)
const RulesyncMcpServerSchema = z.union([
  z.extend(McpServerSchema, {
    targets: z.optional(RulesyncTargetsSchema),
    description: z.optional(z.string()),
    exposed: z.optional(z.literal(false)),
  }),
  z.extend(McpServerSchema, {
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

  getMcpServers({ type = "all" }: { type?: "all" | "exposed" | "modularized" } = {}): McpServers {
    const entries = Object.entries(this.json.mcpServers);

    const filteredEntries = entries.filter(([, serverConfig]) => {
      switch (type) {
        case "all":
          return true;
        case "exposed":
          return !this.modularMcp || serverConfig.exposed;
        case "modularized":
          return this.modularMcp && !serverConfig.exposed;
      }
    });

    return Object.fromEntries(
      filteredEntries.map(([serverName, serverConfig]) => {
        // description is required for modular-mcp servers, so keep it
        const fieldsToOmit =
          type === "modularized"
            ? (["targets", "exposed"] as const)
            : (["targets", "description", "exposed"] as const);
        return [serverName, omit(serverConfig, fieldsToOmit)];
      }),
    );
  }

  getJson(): RulesyncMcpConfig {
    return this.json;
  }
}
