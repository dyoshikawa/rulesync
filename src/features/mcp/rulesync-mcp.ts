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
// Note: targets defaults to ["*"] when omitted (applied during filtering, not at parse time)
const RulesyncMcpServerSchema = z.extend(McpServerSchema, {
  targets: z.optional(RulesyncTargetsSchema),
  description: z.optional(z.string()),
  exposed: z.optional(z.boolean()),
});

const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServerSchema),
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

  constructor(params: RulesyncMcpParams) {
    super(params);

    this.json = JSON.parse(this.fileContent);

    if (params.validate) {
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

  static async fromFile({ validate = true }: RulesyncMcpFromFileParams): Promise<RulesyncMcp> {
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
    });
  }

  getMcpServers(): McpServers {
    const entries = Object.entries(this.json.mcpServers);

    return Object.fromEntries(
      entries.map(([serverName, serverConfig]) => {
        return [serverName, omit(serverConfig, ["targets", "description", "exposed"])];
      }),
    );
  }

  getJson(): RulesyncMcpConfig {
    return this.json;
  }
}
