import { join } from "node:path";

import { omit } from "es-toolkit/object";
import { z } from "zod/mini";

import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_JSONC_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServerSchema, McpServers } from "../../types/mcp.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { RulesyncTargetsSchema, ToolTarget } from "../../types/tool-targets.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";

// Schema for rulesync MCP server (extends base schema with optional targets)
// Note: `targets` is DEPRECATED — author tool-scoped `{toolname}.mcpServers`
// blocks instead. It defaults to ["*"] when omitted (applied during
// filtering, not at parse time).
const RulesyncMcpServerSchema = z.extend(McpServerSchema, {
  targets: z.optional(RulesyncTargetsSchema),
  description: z.optional(z.string()),
  exposed: z.optional(z.boolean()),
});

const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServerSchema),
});
type RulesyncMcpConfig = z.infer<typeof RulesyncMcpConfigSchema>;

/**
 * Tool-scoped MCP block: servers that apply only to one tool. A named entry
 * replaces/adds the same-named shared server wholesale for that tool; `null`
 * removes the shared server for that tool. Mirrors `{toolname}.hooks` in
 * `.rulesync/hooks.json` and `{toolname}.permission` in
 * `.rulesync/permissions.json`.
 */
const toolScopedMcpSchema = z.looseObject({
  mcpServers: z.optional(z.record(z.string(), z.nullable(RulesyncMcpServerSchema))),
});

export const RulesyncMcpFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  ...RulesyncMcpConfigSchema.shape,
  // One optional tool-scoped block per MCP-capable tool target. The
  // deprecated `claudecode-legacy` target reads the `claudecode` block.
  amp: z.optional(toolScopedMcpSchema),
  "antigravity-cli": z.optional(toolScopedMcpSchema),
  "antigravity-ide": z.optional(toolScopedMcpSchema),
  augmentcode: z.optional(toolScopedMcpSchema),
  claudecode: z.optional(toolScopedMcpSchema),
  cline: z.optional(toolScopedMcpSchema),
  codexcli: z.optional(toolScopedMcpSchema),
  copilot: z.optional(toolScopedMcpSchema),
  copilotcli: z.optional(toolScopedMcpSchema),
  cursor: z.optional(toolScopedMcpSchema),
  deepagents: z.optional(toolScopedMcpSchema),
  devin: z.optional(toolScopedMcpSchema),
  factorydroid: z.optional(toolScopedMcpSchema),
  goose: z.optional(toolScopedMcpSchema),
  grokcli: z.optional(toolScopedMcpSchema),
  hermesagent: z.optional(toolScopedMcpSchema),
  junie: z.optional(toolScopedMcpSchema),
  kilo: z.optional(toolScopedMcpSchema),
  kiro: z.optional(toolScopedMcpSchema),
  "kiro-cli": z.optional(toolScopedMcpSchema),
  "kiro-ide": z.optional(toolScopedMcpSchema),
  opencode: z.optional(toolScopedMcpSchema),
  qwencode: z.optional(toolScopedMcpSchema),
  reasonix: z.optional(toolScopedMcpSchema),
  roo: z.optional(toolScopedMcpSchema),
  rovodev: z.optional(toolScopedMcpSchema),
  takt: z.optional(toolScopedMcpSchema),
  vibe: z.optional(toolScopedMcpSchema),
  warp: z.optional(toolScopedMcpSchema),
  zed: z.optional(toolScopedMcpSchema),
});

export type RulesyncMcpParams = RulesyncFileParams;

export type RulesyncMcpFromFileParams = Pick<RulesyncFileFromFileParams, "outputRoot" | "validate">;

export type RulesyncMcpSettablePaths = {
  recommended: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  jsonc: {
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

    // Sources may be authored as JSONC (`mcp.jsonc`); plain JSON is valid
    // JSONC, so both variants parse through the same strict parser.
    this.json = parseJsonc(this.fileContent) as RulesyncMcpConfig;

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
        relativeFilePath: RULESYNC_MCP_FILE_NAME,
      },
      jsonc: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MCP_JSONC_FILE_NAME,
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json",
      },
    };
  }

  validate(): ValidationResult {
    const result = RulesyncMcpFileSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    logger,
  }: RulesyncMcpFromFileParams & { logger?: Logger }): Promise<RulesyncMcp> {
    const paths = this.getSettablePaths();
    const recommendedPath = join(
      outputRoot,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    );
    const jsoncPath = join(outputRoot, paths.jsonc.relativeDirPath, paths.jsonc.relativeFilePath);
    const legacyPath = join(
      outputRoot,
      paths.legacy.relativeDirPath,
      paths.legacy.relativeFilePath,
    );

    // The .jsonc variant takes precedence when both files exist.
    if (await fileExists(jsoncPath)) {
      const fileContent = await readFileContent(jsoncPath);
      return new RulesyncMcp({
        outputRoot,
        relativeDirPath: paths.jsonc.relativeDirPath,
        relativeFilePath: paths.jsonc.relativeFilePath,
        fileContent,
        validate,
      });
    }

    // Check if recommended path exists
    if (await fileExists(recommendedPath)) {
      const fileContent = await readFileContent(recommendedPath);
      return new RulesyncMcp({
        outputRoot,
        relativeDirPath: paths.recommended.relativeDirPath,
        relativeFilePath: paths.recommended.relativeFilePath,
        fileContent,
        validate,
      });
    }

    // Fall back to legacy path
    if (await fileExists(legacyPath)) {
      logger?.warn(
        `⚠️  Using deprecated path "${legacyPath}". Please migrate to "${recommendedPath}"`,
      );
      const fileContent = await readFileContent(legacyPath);
      return new RulesyncMcp({
        outputRoot,
        relativeDirPath: paths.legacy.relativeDirPath,
        relativeFilePath: paths.legacy.relativeFilePath,
        fileContent,
        validate,
      });
    }

    // If neither exists, try to read recommended path (will throw appropriate error)
    const fileContent = await readFileContent(recommendedPath);
    return new RulesyncMcp({
      outputRoot,
      relativeDirPath: paths.recommended.relativeDirPath,
      relativeFilePath: paths.recommended.relativeFilePath,
      fileContent,
      validate,
    });
  }

  getMcpServers(): McpServers {
    // Tolerate missing/empty mcpServers (e.g., a RulesyncMcp constructed
    // from `{}` with validation disabled). Callers that previously read
    // `getJson().mcpServers` via the `isMcpServers` guard relied on this
    // resilience.
    const mcpServers = this.json.mcpServers ?? {};
    const entries = Object.entries(mcpServers);

    return Object.fromEntries(
      entries.map(([serverName, serverConfig]) => {
        // `envVars` is codex-specific: the codex generator reads it directly
        // from the unfiltered source JSON. Strip here so it does not leak
        // into other tools' outputs.
        return [serverName, omit(serverConfig, ["targets", "description", "exposed", "envVars"])];
      }),
    );
  }

  /**
   * Create a new RulesyncMcp with specified fields stripped from each server config.
   * Returns the same instance if no fields need stripping.
   */
  stripMcpServerFields(fields: string[]): RulesyncMcp {
    if (fields.length === 0) return this;

    const filteredServers = Object.fromEntries(
      Object.entries(this.json.mcpServers).map(([name, config]) => [
        name,
        Object.fromEntries(Object.entries(config).filter(([key]) => !fields.includes(key))),
      ]),
    );

    return new RulesyncMcp({
      outputRoot: this.outputRoot,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: JSON.stringify({ mcpServers: filteredServers }, null, 2),
    });
  }

  getJson(): RulesyncMcpConfig {
    return this.json;
  }

  /**
   * Build the effective MCP config for one tool target:
   *
   * 1. Filter shared servers by the DEPRECATED per-server `targets` field
   *    (missing/`["*"]` means every tool). A deprecation warning points at
   *    the tool-scoped blocks that replace it.
   * 2. Overlay the tool-scoped `{toolname}.mcpServers` block: a named entry
   *    replaces/adds the shared server wholesale for this tool; `null`
   *    removes it. The deprecated `claudecode-legacy` target reads the
   *    `claudecode` block.
   *
   * Returns the same instance when neither mechanism is used.
   */
  forTarget({ toolTarget, logger }: { toolTarget: ToolTarget; logger?: Logger }): RulesyncMcp {
    const resolvedTarget = toolTarget === "claudecode-legacy" ? "claudecode" : toolTarget;
    const json: Record<string, unknown> = this.json;
    const sharedServers = this.json.mcpServers ?? {};

    const serverNamesWithTargets = Object.entries(sharedServers)
      .filter(([, serverConfig]) => serverConfig.targets !== undefined)
      .map(([serverName]) => serverName);
    if (serverNamesWithTargets.length > 0) {
      logger?.warn(
        `The per-server "targets" field in ${RULESYNC_MCP_FILE_NAME} is deprecated (servers: ${serverNamesWithTargets.join(", ")}). Author tool-scoped "{toolname}.mcpServers" blocks instead.`,
      );
    }

    const toolBlock = json[resolvedTarget];
    const toolServers =
      isRecord(toolBlock) && isRecord(toolBlock.mcpServers) ? toolBlock.mcpServers : undefined;

    if (serverNamesWithTargets.length === 0 && toolServers === undefined) {
      return this;
    }

    const effectiveServers: Record<string, unknown> = Object.fromEntries(
      Object.entries(sharedServers).filter(([, serverConfig]) => {
        const targets = serverConfig.targets;
        if (targets === undefined) return true;
        return targets.includes("*") || targets.includes(resolvedTarget);
      }),
    );

    for (const [serverName, serverConfig] of Object.entries(toolServers ?? {})) {
      if (serverConfig === null) {
        delete effectiveServers[serverName];
      } else {
        effectiveServers[serverName] = serverConfig;
      }
    }

    return new RulesyncMcp({
      outputRoot: this.outputRoot,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: JSON.stringify({ ...json, mcpServers: effectiveServers }, null, 2),
    });
  }
}
