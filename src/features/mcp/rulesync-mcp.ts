import { basename, dirname, join, relative } from "node:path";

import { omit } from "es-toolkit/object";
import { z } from "zod/mini";

import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_MCP_LEGACY_FILE_NAME,
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
import { RulesyncTargetsSchema, ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { fileExistsStrict, readFileContent, toPosixPath } from "../../utils/file.js";
import { droppedPollutionKeysError, parseJsoncReportingDroppedKeys } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import {
  getRulesyncSourceCandidates,
  RulesyncSourceNotFoundError,
  type RulesyncSourceSettablePaths,
} from "../../utils/rulesync-source-path.js";
import { isRecord } from "../../utils/type-guards.js";

// Schema for rulesync MCP server (extends base schema with optional targets)
// Note: `targets` is DEPRECATED — author tool-scoped `{toolname}.mcpServers`
// blocks instead. It defaults to ["*"] when omitted (applied during
// filtering, not at parse time).
const RulesyncMcpServerSchema = z.extend(McpServerSchema, {
  targets: z.optional(RulesyncTargetsSchema),
  description: z.optional(z.string()),
  exposed: z.optional(z.boolean()),
  // Rulesync-source-only generation filter: a server with `enabled: false` is
  // kept in the source file but emitted to NO tool config at all. Distinct
  // from the canonical `disabled`, which is a pass-through field the tools
  // read (written as `disabled: true`, or translated to `enabled: false` for
  // tools that spell it that way) — `enabled: false` wins and drops the
  // server entirely; `disabled` only matters for servers still emitted.
  // Omitted = enabled, so existing configs keep generating everything.
  enabled: z.optional(z.boolean()),
});

const RulesyncMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), RulesyncMcpServerSchema),
});
type RulesyncMcpConfig = z.infer<typeof RulesyncMcpConfigSchema>;

/**
 * Tool-scoped MCP block: servers that apply only to one tool. A named entry
 * replaces/adds the same-named shared server wholesale for that tool; `null`
 * removes the shared server for that tool. Mirrors `{toolname}.hooks` in
 * `.rulesync/hooks.jsonc` and `{toolname}.permission` in
 * `.rulesync/permissions.jsonc`.
 */
const toolScopedMcpSchema = z.looseObject({
  mcpServers: z.optional(z.record(z.string(), z.nullable(RulesyncMcpServerSchema))),
});

/**
 * Kimi Code's tool-scoped block also carries the `[mcp]` defaults from its
 * shared user config: connect and per-tool-call timeouts that apply to *every*
 * MCP server, including ones rulesync did not write. Per-server
 * `startupTimeoutMs` / `toolTimeoutMs` in `mcpServers` still win.
 *
 * @see https://moonshotai.github.io/kimi-code/en/configuration/config-files.html#mcp
 */
const kimiCodeScopedMcpSchema = z.extend(toolScopedMcpSchema, {
  startupTimeoutMs: z.optional(z.number()),
  toolTimeoutMs: z.optional(z.number()),
});

export const RulesyncMcpFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  ...RulesyncMcpConfigSchema.shape,
  // One optional tool-scoped block per MCP-capable tool target. The
  // deprecated `claudecode-legacy` target reads the `claudecode` block, and
  // the Kiro IDE/CLI targets read the `kiro` block (all three write the same
  // `.kiro/settings/mcp.json`, so per-variant blocks would make that shared
  // file depend on generation order).
  amp: z.optional(toolScopedMcpSchema),
  "antigravity-cli": z.optional(toolScopedMcpSchema),
  "antigravity-ide": z.optional(toolScopedMcpSchema),
  aiassistant: z.optional(toolScopedMcpSchema),
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
  "kimi-code": z.optional(kimiCodeScopedMcpSchema),
  kiro: z.optional(toolScopedMcpSchema),
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

export type RulesyncMcpFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "validate" | "relativeDirPath"
>;

export type RulesyncMcpSettablePaths = RulesyncSourceSettablePaths;

/**
 * The tool-scoped block keys that carry a `{toolname}.mcpServers` sub-map.
 * Derived from `RulesyncMcpFileSchema`'s own shape so this set can never drift
 * from the schema — every tool-scoped block declared above is treated as a
 * "merge servers by name" site by `mergeMcpJsonOverlays`, and everything else
 * (including `$schema` and top-level Kimi Code timeout fields) is replaced
 * atomically.
 */
const TOOL_SCOPED_MCP_KEYS = new Set<string>(
  Object.keys(RulesyncMcpFileSchema.def.shape).filter(
    (key) => key !== "$schema" && key !== "mcpServers",
  ),
);

/**
 * Return the first candidate path (recommended, then legacy variants) that
 * exists under `outputRoot`, or `undefined` when none is present. Shared
 * between `fromFile` (single-root) and `fromRoots` (multi-root) so both
 * paths honour the same intra-root resolution order.
 *
 * When `overrideDirPath` is provided it replaces the candidates'
 * class-level `relativeDirPath` (which defaults to `.rulesync/`) so the
 * caller can point at a non-default source tree (e.g. `.rulesync.local/`).
 * Also returned is the effective `relativeDirPath` for the winning
 * candidate so the caller can reconstruct a `RulesyncMcp` with matching
 * anchor fields.
 */
async function findFirstExistingCandidate({
  paths,
  outputRoot,
  overrideDirPath,
}: {
  paths: RulesyncMcpSettablePaths;
  outputRoot: string;
  overrideDirPath?: string;
}): Promise<
  { filePath: string; candidate: { relativeDirPath: string; relativeFilePath: string } } | undefined
> {
  for (const candidate of getRulesyncSourceCandidates({ paths })) {
    const candidateDirPath = overrideDirPath ?? candidate.relativeDirPath;
    const filePath = join(outputRoot, candidateDirPath, candidate.relativeFilePath);

    if (await fileExistsStrict(filePath)) {
      return {
        filePath,
        candidate: {
          relativeDirPath: candidateDirPath,
          relativeFilePath: candidate.relativeFilePath,
        },
      };
    }
  }

  return undefined;
}

/**
 * Merge two parsed MCP JSON objects with the one-level policy from the
 * inputRoots plan: the top-level `mcpServers` map and each
 * `<toolname>.mcpServers` sub-map are merged by server name (later wins per
 * key). Every other value — individual server configs, other top-level keys
 * — is replaced atomically. This keeps the merge predictable: an overlay can
 * add or replace whole shared servers, but a partial patch of one server's
 * `args`/`env` is deliberately not supported.
 */
function getRecordField({
  value,
  path,
}: {
  value: unknown;
  path: string;
}): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`Invalid MCP overlay: '${path}' must be an object.`);
  }
  return value;
}

/**
 * Overlay one record onto another, dropping any overlay key that could reach
 * `Object.prototype`. Every overlay merge goes through this so a `__proto__`
 * entry cannot enter the merged config from any depth — top-level
 * `mcpServers`, a tool-scoped block, or that block's own `mcpServers`.
 */
function mergeRecordsSkippingPollutionKeys({
  base,
  overlay,
}: {
  base: Record<string, unknown>;
  overlay: Record<string, unknown>;
}): Record<string, unknown> {
  const merged = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (isPrototypePollutionKey(key)) continue;

    merged[key] = value;
  }

  return merged;
}

export function mergeMcpJsonOverlays({
  base,
  overlay,
}: {
  base: Record<string, unknown>;
  overlay: Record<string, unknown>;
}): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, overlayValue] of Object.entries(overlay)) {
    if (isPrototypePollutionKey(key)) continue;

    if (key === "mcpServers") {
      const baseServers = getRecordField({ value: base.mcpServers, path: "mcpServers" });
      const overlayServers = getRecordField({ value: overlayValue, path: "mcpServers" });

      merged.mcpServers = mergeRecordsSkippingPollutionKeys({
        base: baseServers,
        overlay: overlayServers,
      });
      continue;
    }

    if (TOOL_SCOPED_MCP_KEYS.has(key)) {
      const baseBlock = getRecordField({ value: base[key], path: key });
      const overlayBlock = getRecordField({ value: overlayValue, path: key });
      const mergedBlock: Record<string, unknown> = mergeRecordsSkippingPollutionKeys({
        base: baseBlock,
        overlay: overlayBlock,
      });

      const baseServers = getRecordField({
        value: baseBlock.mcpServers,
        path: `${key}.mcpServers`,
      });
      const overlayServers = getRecordField({
        value: overlayBlock.mcpServers,
        path: `${key}.mcpServers`,
      });

      if (Object.keys(baseServers).length > 0 || Object.keys(overlayServers).length > 0) {
        mergedBlock.mcpServers = mergeRecordsSkippingPollutionKeys({
          base: baseServers,
          overlay: overlayServers,
        });
      }

      merged[key] = mergedBlock;
      continue;
    }

    merged[key] = overlayValue;
  }

  return merged;
}

export class RulesyncMcp extends RulesyncFile {
  private readonly json: RulesyncMcpConfig;
  /**
   * Prototype-pollution keys the parser removed. They are dropped before the
   * schema ever sees them, so without this record a server named `__proto__`
   * would produce neither an error nor an entry in any generated file.
   */
  private readonly droppedKeys: readonly string[];

  constructor(params: RulesyncMcpParams) {
    super(params);

    // Sources may be authored as JSONC (`mcp.jsonc`); plain JSON is valid
    // JSONC, so both variants parse through the same strict parser.
    const { value, droppedKeys } = parseJsoncReportingDroppedKeys({ content: this.fileContent });
    this.json = value as RulesyncMcpConfig;
    this.droppedKeys = droppedKeys;

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
      legacy: [
        {
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_MCP_LEGACY_FILE_NAME,
        },
        {
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: ".mcp.json",
        },
      ],
    };
  }

  validate(): ValidationResult {
    if (this.droppedKeys.length > 0) {
      return {
        success: false,
        error: droppedPollutionKeysError({
          sourcePath: this.getRelativePathFromCwd(),
          droppedKeys: this.droppedKeys,
        }),
      };
    }
    const result = RulesyncMcpFileSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  /**
   * Load and merge MCP source files across the configured input roots.
   *
   * `inputRoots` entries are the source trees themselves (e.g.
   * `/repo/.rulesync`, `/repo/.rulesync.local`). Per-root behavior mirrors
   * `fromFile`: each root's own candidate paths (recommended `mcp.jsonc`,
   * legacy `mcp.json`, deprecated `.mcp.json`) are checked INSIDE that
   * source tree and the first hit is loaded. Roots that have no candidate
   * contribute nothing.
   *
   * Cross-root behavior: the parsed JSON objects are folded left-to-right
   * with `mergeMcpJsonOverlays`, so later roots overlay earlier ones by
   * server name (one level deep) and replace every other value atomically.
   * With one root, this delegates to `fromFile` so JSONC formatting and the
   * actual candidate path are preserved. With multiple roots, each source is
   * parsed and schema-validated before merging so failures name the originating
   * file. The merged object is necessarily synthetic, serialized JSON anchored
   * to the first root's recommended path.
   *
   * A multi-root configuration where only one root actually supplies a file is
   * treated as the single-root case: nothing is merged, so the original file
   * content is kept verbatim (preserving JSONC comments) and the instance is
   * anchored at the root that supplied it rather than at the primary root's
   * recommended path.
   *
   * When no root supplies any candidate, this raises
   * `RulesyncSourceNotFoundError` against the primary root's recommended path,
   * matching the single-root behavior of `fromFile`. Absence is deliberately
   * never reported as a bare `ENOENT`, which callers cannot tell apart from a
   * read that was supposed to succeed.
   */
  static async fromRoots({
    inputRoots,
    validate = true,
    logger,
  }: {
    inputRoots: readonly [string, ...string[]];
    validate?: boolean;
    logger?: Logger;
  }): Promise<RulesyncMcp> {
    if (inputRoots.length === 1) {
      const [primary] = inputRoots;

      return this.fromFile({
        outputRoot: dirname(primary),
        relativeDirPath: basename(primary),
        validate,
        logger,
      });
    }

    const paths = this.getSettablePaths();
    const rootSources: {
      record: Record<string, unknown>;
      outputRoot: string;
      relativeDirPath: string;
      relativeFilePath: string;
      fileContent: string;
    }[] = [];

    for (const root of inputRoots) {
      // Each `root` is a source tree itself (e.g. `/repo/.rulesync.local`);
      // its parent is the anchor and its basename replaces the default
      // `.rulesync/` prefix in the candidate lookup.
      const parent = dirname(root);
      const treeName = basename(root);
      const found = await findFirstExistingCandidate({
        paths,
        outputRoot: parent,
        overrideDirPath: treeName,
      });

      if (found === undefined) continue;

      const { filePath, candidate } = found;

      if (filePath.endsWith(".mcp.json")) {
        const recommendedPath = join(parent, treeName, paths.recommended.relativeFilePath);

        logger?.warn(
          `⚠️  Using deprecated path "${filePath}". Please migrate to "${recommendedPath}"`,
        );
      }

      const fileContent = await readFileContent(filePath);
      let parsed: Record<string, unknown>;
      let droppedKeys: readonly string[];

      try {
        // The reporting parse, not the plain one: a merged config is
        // re-serialized from these records, so a `__proto__` server dropped
        // here would vanish without the single-root path's report ever running.
        const result = parseJsoncReportingDroppedKeys({ content: fileContent });

        if (!isRecord(result.value)) {
          throw new Error("Expected a JSON object.");
        }

        parsed = result.value;
        droppedKeys = result.droppedKeys;
      } catch (error) {
        throw new Error(`Invalid MCP source file '${filePath}': ${formatError(error)}`, {
          cause: error,
        });
      }

      if (validate) {
        // Thrown outside the wrapper above: that message already names the
        // file, and this one names it too. The path is made relative and posix
        // to match how the single-root path reports the same problem, which
        // goes through `getRelativePathFromCwd()`.
        if (droppedKeys.length > 0) {
          throw droppedPollutionKeysError({
            sourcePath: toPosixPath(relative(process.cwd(), filePath)),
            droppedKeys,
          });
        }

        const result = RulesyncMcpFileSchema.safeParse(parsed);

        if (!result.success) {
          throw new Error(`Invalid MCP source file '${filePath}': ${formatError(result.error)}`, {
            cause: result.error,
          });
        }
      }

      rootSources.push({
        record: parsed,
        outputRoot: parent,
        relativeDirPath: candidate.relativeDirPath,
        relativeFilePath: candidate.relativeFilePath,
        fileContent,
      });
    }

    if (rootSources.length === 0) {
      const primary = inputRoots[0];

      return this.fromFile({
        outputRoot: dirname(primary),
        relativeDirPath: basename(primary),
        validate,
        logger,
      });
    }

    const onlySource = rootSources.length === 1 ? rootSources[0]! : undefined;

    if (onlySource !== undefined) {
      // Nothing was merged, so keep the file exactly as authored — re-emitting
      // it through `JSON.stringify` would drop JSONC comments — and anchor the
      // instance at the root that actually supplied it rather than at the
      // primary root's recommended path.
      return new RulesyncMcp({
        outputRoot: onlySource.outputRoot,
        relativeDirPath: onlySource.relativeDirPath,
        relativeFilePath: onlySource.relativeFilePath,
        fileContent: onlySource.fileContent,
        validate,
      });
    }

    const merged = rootSources.reduce<Record<string, unknown>>(
      (acc, next) => mergeMcpJsonOverlays({ base: acc, overlay: next.record }),
      {},
    );

    // A merged config has no single source file, so it is anchored at the
    // primary root's recommended path; comments cannot survive a merge of
    // several files anyway.
    const primary = inputRoots[0];

    return new RulesyncMcp({
      outputRoot: dirname(primary),
      relativeDirPath: basename(primary),
      relativeFilePath: paths.recommended.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
      validate,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    validate = true,
    logger,
  }: RulesyncMcpFromFileParams & { logger?: Logger }): Promise<RulesyncMcp> {
    const paths = this.getSettablePaths();
    const overrideDirPath = relativeDirPath;

    for (const candidate of getRulesyncSourceCandidates({ paths })) {
      const candidateDirPath = overrideDirPath ?? candidate.relativeDirPath;
      const filePath = join(outputRoot, candidateDirPath, candidate.relativeFilePath);

      if (!(await fileExistsStrict(filePath))) {
        continue;
      }

      if (candidate.relativeFilePath === ".mcp.json") {
        const recommendedPath = join(
          outputRoot,
          candidateDirPath,
          paths.recommended.relativeFilePath,
        );

        logger?.warn(
          `⚠️  Using deprecated path "${filePath}". Please migrate to "${recommendedPath}"`,
        );
      }

      const fileContent = await readFileContent(filePath);

      return new RulesyncMcp({
        outputRoot,
        relativeDirPath: candidateDirPath,
        relativeFilePath: candidate.relativeFilePath,
        fileContent,
        validate,
      });
    }

    const fallbackDirPath = overrideDirPath ?? paths.recommended.relativeDirPath;
    const recommendedPath = join(outputRoot, fallbackDirPath, paths.recommended.relativeFilePath);

    // Every candidate was ruled out, so absence is reported as itself rather
    // than as whatever `readFileContent` would have raised. A bare `ENOENT`
    // here reads the same as one thrown from deep inside a read that was
    // supposed to succeed, and callers have to tell those two apart.
    throw new RulesyncSourceNotFoundError(`No ${recommendedPath} found.`);
  }

  /**
   * Return one server exactly as authored, before `getMcpServers()` strips
   * rulesync- and tool-specific fields. Keep this lookup here so every target
   * that re-merges one of those fields shares the same own-property and
   * prototype-pollution guards.
   */
  getRawMcpServer(name: string): unknown {
    if (isPrototypePollutionKey(name)) return undefined;

    const mcpServers = isRecord(this.json) ? this.json.mcpServers : undefined;
    return isRecord(mcpServers) && Object.hasOwn(mcpServers, name) ? mcpServers[name] : undefined;
  }

  getMcpServers(): McpServers {
    // Tolerate missing/empty mcpServers (e.g., a RulesyncMcp constructed
    // from `{}` with validation disabled). Callers that previously read
    // `getJson().mcpServers` via the `isMcpServers` guard relied on this
    // resilience.
    const mcpServers = this.json.mcpServers ?? {};
    const entries = Object.entries(mcpServers);

    return Object.fromEntries(
      entries
        // `enabled: false` is the rulesync-source-only generation filter: the
        // definition stays in the source file and produces no output. This
        // also covers tool-scoped `{toolname}.mcpServers` entries, which
        // `forTarget()` merges into the shared map before this runs.
        .filter(([, serverConfig]) => serverConfig.enabled !== false)
        .map(([serverName, serverConfig]) => {
          // `envVars` and `experimentalEnvironment` are codex-specific: the
          // codex generator reads them directly from the unfiltered source
          // JSON. Strip here so they do not leak into other tools' outputs —
          // including the raw `experimental_environment` spelling, which is
          // what someone copying a codex config writes and which no other tool
          // understands. `musecodeMode` is the same arrangement for Muse Code,
          // whose generator re-merges it from the raw JSON the same way, and
          // `rovodevEnableInstructions` for Rovo Dev — along with the raw
          // `enable_instructions` spelling someone copying a Rovo Dev config
          // writes. That pair is stripped for a stronger reason than the
          // others: it decides whether a third-party server's own instructions
          // are pasted into the agent's system prompt, so carrying it to a tool
          // the author never named would widen what steers the model.
          // `enabled` is stripped because OpenCode, Kilo, Grok CLI
          // and Goose have a NATIVE `enabled` field with different semantics a
          // leaked value would silently collide with.
          return [
            serverName,
            omit(serverConfig, [
              "targets",
              "description",
              "exposed",
              "envVars",
              "experimentalEnvironment",
              "experimental_environment",
              "musecodeMode",
              "rovodevEnableInstructions",
              "enable_instructions",
              "enabled",
            ]),
          ];
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
   * 2. Overlay the tool-scoped `{toolname}.mcpServers` block(s): a named
   *    entry replaces/adds the shared server wholesale for this tool; `null`
   *    removes it.
   *
   * Targets that share one output file resolve identically so the shared
   * file's content never depends on which of them generates last — see
   * `resolveMcpTarget` for the alias groups (kiro trio, claudecode/-legacy,
   * and the Antigravity pair).
   *
   * Returns the same instance when neither mechanism is used.
   */
  forTarget({ toolTarget, logger }: { toolTarget: ToolTarget; logger?: Logger }): RulesyncMcp {
    const { blockKeys, acceptedTargetNames } = resolveMcpTarget({ toolTarget });
    const json: Record<string, unknown> = this.json;
    const sharedServers = this.json.mcpServers ?? {};

    const serverNamesWithTargets = Object.entries(sharedServers)
      .filter(([, serverConfig]) => serverConfig.targets !== undefined)
      .map(([serverName]) => serverName);
    if (serverNamesWithTargets.length > 0) {
      this.warnTargetsDeprecationOnce({ serverNamesWithTargets, logger });
    }

    // Blocks authored under a name that always resolves to another key
    // (e.g. "kiro-cli" instead of "kiro") are never read — surface that
    // instead of silently ignoring them.
    for (const ignoredKey of MCP_IGNORED_ALIAS_SOURCE_KEYS) {
      if (!isRecord(json[ignoredKey])) continue;
      this.warnOncePerFile(
        `alias:${ignoredKey}`,
        `The "${ignoredKey}" block in ${join(this.relativeDirPath, this.relativeFilePath)} is ignored. Author it under the "${MCP_BLOCK_KEY_ALIASES[ignoredKey]}" key instead.`,
        logger,
      );
    }

    const toolBlockKeys = Object.keys(json).filter((key) => MCP_TOOL_BLOCK_KEYS.has(key));

    if (serverNamesWithTargets.length === 0 && toolBlockKeys.length === 0) {
      return this;
    }

    const effectiveServers: Record<string, unknown> = Object.fromEntries(
      Object.entries(sharedServers).filter(([, serverConfig]) => {
        const targets = serverConfig.targets;
        if (targets === undefined) return true;
        return targets.some((target) => target === "*" || acceptedTargetNames.has(target));
      }),
    );

    for (const blockKey of blockKeys) {
      const toolBlock = json[blockKey];
      const toolServers =
        isRecord(toolBlock) && isRecord(toolBlock.mcpServers) ? toolBlock.mcpServers : undefined;
      for (const [serverName, serverConfig] of Object.entries(toolServers ?? {})) {
        // Defense in depth: parseJsonc already drops prototype-pollution
        // keys, but this bracket assignment must never rely on that.
        if (isPrototypePollutionKey(serverName)) continue;
        if (serverConfig === null) {
          delete effectiveServers[serverName];
        } else {
          effectiveServers[serverName] = serverConfig;
        }
      }
    }

    // Strip every tool-scoped block so translators that spread the whole
    // rulesync JSON into their output (e.g. Junie) never leak other tools'
    // blocks into a generated config.
    const rest = Object.fromEntries(
      Object.entries(json).filter(([key]) => !MCP_TOOL_BLOCK_KEYS.has(key)),
    );

    return new RulesyncMcp({
      outputRoot: this.outputRoot,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: JSON.stringify({ ...rest, mcpServers: effectiveServers }, null, 2),
    });
  }

  /**
   * The deprecation warning would otherwise repeat once per generated tool
   * target (a full `--targets "*"` run creates one RulesyncMcp per target),
   * so it is deduplicated per source file path.
   */
  private warnTargetsDeprecationOnce({
    serverNamesWithTargets,
    logger,
  }: {
    serverNamesWithTargets: string[];
    logger?: Logger;
  }): void {
    this.warnOncePerFile(
      "targets-deprecation",
      `The per-server "targets" field in ${join(this.relativeDirPath, this.relativeFilePath)} is deprecated (servers: ${serverNamesWithTargets.join(", ")}). Author tool-scoped "{toolname}.mcpServers" blocks instead.`,
      logger,
    );
  }

  private warnOncePerFile(kind: string, message: string, logger?: Logger): void {
    const dedupeKey = `${this.getFilePath()}#${kind}`;
    if (warnedOnceKeys.has(dedupeKey)) return;
    warnedOnceKeys.add(dedupeKey);
    logger?.warn(message);
  }
}

/**
 * All keys that may hold a tool-scoped `{toolname}.mcpServers` block. Derived
 * from the MCP processor's target tuple so a newly added MCP-capable tool is
 * covered automatically.
 */
const MCP_TOOL_BLOCK_KEYS: ReadonlySet<string> = new Set(mcpProcessorToolTargetTuple);

/**
 * Targets whose `{toolname}.mcpServers` block key is ALWAYS another target's
 * key (at every scope): `claudecode-legacy` is a deprecated alias of
 * `claudecode`, and the Kiro IDE/CLI targets share the `kiro` block because
 * all three write the same `.kiro/settings/mcp.json` at both scopes. Blocks
 * authored under these source names are never read (a warning is emitted).
 */
const MCP_BLOCK_KEY_ALIASES: Partial<Record<string, string>> = {
  "claudecode-legacy": "claudecode",
  "kiro-cli": "kiro",
  "kiro-ide": "kiro",
};

const MCP_IGNORED_ALIAS_SOURCE_KEYS = Object.keys(MCP_BLOCK_KEY_ALIASES);

type McpTargetResolution = {
  /** Tool-scoped block keys applied in order (a later block wins per server). */
  blockKeys: readonly string[];
  /** Names accepted by the deprecated per-server `targets` filter. */
  acceptedTargetNames: ReadonlySet<string>;
};

/**
 * Resolve which tool-scoped blocks a target reads and which deprecated
 * `targets` names match it. Targets that share one output file must resolve
 * identically, otherwise the shared file's content would depend on which
 * target happened to generate last:
 *
 * - `claudecode-legacy` aliases `claudecode`; the Kiro trio shares `kiro`
 *   (same output file at both scopes).
 * - `antigravity-ide` / `antigravity-cli` share their output file at BOTH
 *   scopes — `.agents/mcp_config.json` (project) and
 *   `~/.gemini/config/mcp_config.json` (global; both global subdirs are
 *   `config`) — so both targets always apply both blocks in a fixed order
 *   (`antigravity-ide` first, `antigravity-cli` second — the CLI block wins
 *   per server on conflict).
 */
function resolveMcpTarget({ toolTarget }: { toolTarget: ToolTarget }): McpTargetResolution {
  if (toolTarget === "claudecode" || toolTarget === "claudecode-legacy") {
    return {
      blockKeys: ["claudecode"],
      acceptedTargetNames: new Set(["claudecode", "claudecode-legacy"]),
    };
  }
  if (toolTarget === "kiro" || toolTarget === "kiro-cli" || toolTarget === "kiro-ide") {
    return {
      blockKeys: ["kiro"],
      acceptedTargetNames: new Set(["kiro", "kiro-cli", "kiro-ide"]),
    };
  }
  if (toolTarget === "antigravity-ide" || toolTarget === "antigravity-cli") {
    return {
      blockKeys: ["antigravity-ide", "antigravity-cli"],
      acceptedTargetNames: new Set(["antigravity-ide", "antigravity-cli"]),
    };
  }
  return { blockKeys: [toolTarget], acceptedTargetNames: new Set([toolTarget]) };
}

/**
 * Deduplication set for once-per-source-file warnings, keyed by
 * `<absolute file path>#<warning kind>`. Never cleared: rulesync CLI runs
 * are one-shot processes, and in a long-lived embedding (the rulesync MCP
 * server) repeating the same warning per generate would only add noise.
 */
const warnedOnceKeys = new Set<string>();
