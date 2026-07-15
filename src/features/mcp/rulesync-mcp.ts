import { join } from "node:path";

import { omit } from "es-toolkit/object";
import { z } from "zod/mini";

import {
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
import { mcpProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import { RulesyncTargetsSchema } from "../../types/tool-targets.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseJsonc, readJsoncTwinOrNull } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";

// Schema for rulesync MCP server (extends base schema with optional targets)
// Note: `targets` is DEPRECATED — use the tool-scoped `{toolname}.mcpServers`
// blocks instead. It defaults to ["*"] when omitted and is honored (with a
// deprecation warning) by the per-target filtering in `forTarget`.
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
 * Tool-scoped override block: `{toolname}.mcpServers` carries server entries
 * that apply ONLY to that tool, mirroring `{toolname}.hooks` in
 * `.rulesync/hooks.json` and `{toolname}.permission` in
 * `.rulesync/permissions.json`. A server entry replaces (or adds to) the
 * shared `mcpServers` entry of the same name wholesale for that tool; a
 * `null` entry removes the shared server for that tool. This supersedes the
 * deprecated per-server `targets` field.
 */
const RulesyncMcpToolOverrideSchema = z.looseObject({
  mcpServers: z.optional(z.record(z.string(), z.union([RulesyncMcpServerSchema, z.null()]))),
});

const toolOverrideShape = Object.fromEntries(
  mcpProcessorToolTargetTuple.map((target) => [target, z.optional(RulesyncMcpToolOverrideSchema)]),
);

/**
 * Tool targets that fall back to another target's override key because they
 * write the same output file (`kiro`/`kiro-cli`/`kiro-ide` share
 * `.kiro/settings/mcp.json`; `claudecode-legacy` shares `.mcp.json` with
 * `claudecode`). An exact `{toolname}` key still wins over the alias. Without
 * the fallback, generating several of these targets would write diverging
 * server sets into the same file in generation order.
 */
const MCP_OVERRIDE_KEY_ALIASES: Readonly<Record<string, string>> = {
  "kiro-cli": "kiro",
  "kiro-ide": "kiro",
  "claudecode-legacy": "claudecode",
};

export const RulesyncMcpFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  ...RulesyncMcpConfigSchema.shape,
  ...toolOverrideShape,
});

export type RulesyncMcpParams = RulesyncFileParams;

export type RulesyncMcpFromFileParams = Pick<RulesyncFileFromFileParams, "outputRoot" | "validate">;

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

    // JSONC is a superset of JSON, so both `.json` and `.jsonc` sources parse here.
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
        relativeFilePath: "mcp.json",
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
    const legacyPath = join(
      outputRoot,
      paths.legacy.relativeDirPath,
      paths.legacy.relativeFilePath,
    );

    // The `.jsonc` twin wins over `.json` when both exist.
    const jsoncTwin = await readJsoncTwinOrNull({
      outputRoot,
      relativeDirPath: paths.recommended.relativeDirPath,
      jsoncFileName: RULESYNC_MCP_JSONC_FILE_NAME,
    });
    if (jsoncTwin) {
      return new RulesyncMcp({
        outputRoot,
        relativeDirPath: paths.recommended.relativeDirPath,
        ...jsoncTwin,
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
   * Resolve the effective server map for a tool target:
   * 1. Apply the DEPRECATED per-server `targets` filter (a server whose
   *    `targets` array names neither `"*"` nor the target is excluded), with a
   *    deprecation warning pointing at the tool-scoped blocks.
   * 2. Merge the tool-scoped `{toolname}.mcpServers` block: an entry replaces
   *    (or adds to) the shared server of the same name wholesale; `null`
   *    removes it for this target.
   * Every tool-scoped block is stripped from the returned instance so it can
   * never leak into tool outputs that spread the source JSON. Returns the same
   * instance when nothing applies.
   */
  forTarget({ toolTarget, logger }: { toolTarget: string; logger?: Logger }): RulesyncMcp {
    const json: Record<string, unknown> = this.json;
    const sharedServers = this.json.mcpServers ?? {};
    const sourcePath = join(this.getRelativeDirPath(), this.getRelativeFilePath());

    const filteredServers: McpServers = {};
    const excludedServerNames: string[] = [];
    let hasFilteringTargets = false;
    for (const [serverName, serverConfig] of Object.entries(sharedServers)) {
      const targets: readonly string[] | undefined = serverConfig.targets;
      // `["*"]` (the old explicit default) never filters, so it does not
      // trigger the deprecation warning.
      if (Array.isArray(targets) && !targets.includes("*")) {
        hasFilteringTargets = true;
        if (!targets.includes(toolTarget)) {
          excludedServerNames.push(serverName);
          continue;
        }
      }
      filteredServers[serverName] = serverConfig;
    }
    if (hasFilteringTargets) {
      logger?.warn(
        `⚠️  The per-server "targets" field in ${sourcePath} is deprecated. ` +
          `Move tool-specific servers into the tool-scoped "{toolname}.mcpServers" block instead.`,
      );
    }
    if (excludedServerNames.length > 0) {
      logger?.warn(
        `MCP servers [${excludedServerNames.join(", ")}] are excluded from the "${toolTarget}" output by their "targets" field.`,
      );
    }

    const overrideKey =
      json[toolTarget] !== undefined
        ? toolTarget
        : (MCP_OVERRIDE_KEY_ALIASES[toolTarget] ?? toolTarget);
    const overrideBlock = json[overrideKey];
    const overrideServers =
      isPlainObject(overrideBlock) && isPlainObject(overrideBlock.mcpServers)
        ? overrideBlock.mcpServers
        : undefined;

    const hasToolOverrideKeys = mcpProcessorToolTargetTuple.some(
      (target) => json[target] !== undefined,
    );
    const filteredAnyServer =
      Object.keys(filteredServers).length !== Object.keys(sharedServers).length;
    if (!hasToolOverrideKeys && !filteredAnyServer) {
      return this;
    }

    const effectiveServers: Record<string, unknown> = { ...filteredServers };
    for (const [serverName, serverConfig] of Object.entries(overrideServers ?? {})) {
      if (serverConfig === null) {
        delete effectiveServers[serverName];
      } else {
        effectiveServers[serverName] = serverConfig;
      }
    }

    const toolOverrideKeys: ReadonlySet<string> = new Set(mcpProcessorToolTargetTuple);
    const rest = Object.fromEntries(
      Object.entries(json).filter(([key]) => !toolOverrideKeys.has(key)),
    );

    return new RulesyncMcp({
      outputRoot: this.outputRoot,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: JSON.stringify({ ...rest, mcpServers: effectiveServers }, null, 2),
      validate: false,
    });
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
}
