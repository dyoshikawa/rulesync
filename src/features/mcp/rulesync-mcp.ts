import { join } from "node:path";

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
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import {
  getRulesyncSourceCandidates,
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

export type RulesyncMcpFromFileParams = Pick<RulesyncFileFromFileParams, "outputRoot" | "validate">;

export type RulesyncMcpSettablePaths = RulesyncSourceSettablePaths;

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
    for (const candidate of getRulesyncSourceCandidates({ paths })) {
      const filePath = join(outputRoot, candidate.relativeDirPath, candidate.relativeFilePath);
      if (!(await fileExists(filePath))) {
        continue;
      }
      if (candidate.relativeFilePath === ".mcp.json") {
        const recommendedPath = join(
          outputRoot,
          paths.recommended.relativeDirPath,
          paths.recommended.relativeFilePath,
        );
        logger?.warn(
          `⚠️  Using deprecated path "${filePath}". Please migrate to "${recommendedPath}"`,
        );
      }
      const fileContent = await readFileContent(filePath);
      return new RulesyncMcp({
        outputRoot,
        relativeDirPath: candidate.relativeDirPath,
        relativeFilePath: candidate.relativeFilePath,
        fileContent,
        validate,
      });
    }

    const recommendedPath = join(
      outputRoot,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath,
    );
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
      entries
        // `enabled: false` is the rulesync-source-only generation filter: the
        // definition stays in the source file and produces no output. This
        // also covers tool-scoped `{toolname}.mcpServers` entries, which
        // `forTarget()` merges into the shared map before this runs.
        .filter(([, serverConfig]) => serverConfig.enabled !== false)
        .map(([serverName, serverConfig]) => {
          // `envVars` is codex-specific: the codex generator reads it directly
          // from the unfiltered source JSON. Strip here so it does not leak
          // into other tools' outputs. `enabled` is stripped because OpenCode,
          // Kilo, Grok CLI and Goose have a NATIVE `enabled` field with
          // different semantics a leaked value would silently collide with.
          return [
            serverName,
            omit(serverConfig, ["targets", "description", "exposed", "envVars", "enabled"]),
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
