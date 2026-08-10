import { join } from "node:path";

import { nonnegative, z } from "zod/mini";

import { KIRO_AGENTS_DIR_PATH, KIRO_HOOKS_FILE_NAME } from "../../constants/kiro-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  KIRO_HOOK_EVENTS,
  CANONICAL_TO_KIRO_EVENT_NAMES,
  KIRO_AGENT_CONFIG_NATIVE_EVENT_NAMES,
  KIRO_TO_CANONICAL_EVENT_NAMES,
  safeString,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Convert canonical hooks config to the legacy embedded Kiro agent-config
 * format.
 * Filters shared hooks to KIRO_HOOK_EVENTS, merges config.kiro?.hooks,
 * then maps event names and emits the agent config's hook arrays.
 */
/** Build the agent-config hook entries for a single canonical event's definitions. */
function buildKiroEntriesForEvent(definitions: HooksConfig["hooks"][string]): unknown[] {
  const entries: unknown[] = [];
  for (const def of definitions) {
    if ((def.type ?? "command") !== "command") continue;
    entries.push({
      command: def.command,
      ...(def.matcher !== undefined &&
        def.matcher !== null &&
        def.matcher !== "" && { matcher: def.matcher }),
      ...(def.timeout !== undefined &&
        def.timeout !== null &&
        def.timeout > 0 && { timeout_ms: def.timeout }),
      ...(def.cacheTtl !== undefined && { cache_ttl_seconds: def.cacheTtl }),
      ...(def.name !== undefined && def.name !== null && { name: def.name }),
      ...(def.description !== undefined &&
        def.description !== null && { description: def.description }),
    });
  }
  return entries;
}

/**
 * Event keys the embedded agent-config format defines: the canonical events it
 * supports plus its own native spellings (`agentSpawn`, `userPromptSubmit`, …).
 *
 * The `kiro` override block is shared with the standalone `.kiro/hooks/*.json`
 * targets, whose vocabulary is different (`PostFileSave`, `PreTaskExec`, …).
 * Passing those through here would write event keys Kiro does not define into
 * `.kiro/agents/default.json`, so they are dropped instead.
 * @see https://kiro.dev/docs/cli/v3/hooks-migration/
 */
const KIRO_AGENT_CONFIG_EVENT_KEYS: ReadonlySet<string> = new Set([
  ...KIRO_HOOK_EVENTS,
  ...KIRO_AGENT_CONFIG_NATIVE_EVENT_NAMES,
]);

function canonicalToKiroHooks({
  config,
  logger,
}: {
  config: HooksConfig;
  logger?: Logger;
}): Record<string, unknown[]> {
  // The `kiro` alias is the sole writer of this format, but the block it reads
  // is shared with the standalone-format targets (see KIRO_HOOKS_OVERRIDE_KEY).
  const overrideKey = "kiro";
  const kiroSupported: Set<string> = new Set(KIRO_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (kiroSupported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  // Tool-specific overrides bypass the KIRO_HOOK_EVENTS filter by design —
  // users who define tool-level overrides are expected to know the target
  // tool's event surface — but only within this format's own vocabulary: the
  // block is shared with the standalone-format targets, whose triggers this
  // file cannot express.
  const overrideHooks: HooksConfig["hooks"] = {};
  const droppedEvents: string[] = [];
  for (const [event, defs] of Object.entries(config[overrideKey]?.hooks ?? {})) {
    if (KIRO_AGENT_CONFIG_EVENT_KEYS.has(event)) {
      overrideHooks[event] = defs;
    } else {
      droppedEvents.push(event);
    }
  }
  if (droppedEvents.length > 0) {
    logger?.warn(
      `Skipped hook event(s) from the "kiro" override block for the deprecated kiro agent config (no event key of that format): ${droppedEvents.join(", ")}. They are emitted for the kiro-cli / kiro-ide targets, which read the same block.`,
    );
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    ...overrideHooks,
  };
  const kiro: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const kiroEventName = CANONICAL_TO_KIRO_EVENT_NAMES[eventName] ?? eventName;
    const entries = buildKiroEntriesForEvent(definitions);
    if (entries.length > 0) {
      if (kiro[kiroEventName]) {
        kiro[kiroEventName].push(...entries);
      } else {
        kiro[kiroEventName] = entries;
      }
    }
  }
  return kiro;
}

/**
 * Hook entry as stored in each event's array of the agent config.
 * Uses `z.looseObject` so that unknown fields added by future Kiro
 * versions are accepted and silently ignored during import.
 */
const KiroHookEntrySchema = z.looseObject({
  command: z.optional(safeString),
  matcher: z.optional(z.string()),
  timeout_ms: z.optional(z.number()),
  cache_ttl_seconds: z.optional(z.number().check(nonnegative())),
  name: z.optional(z.string()),
  description: z.optional(z.string()),
});
type KiroHookEntry = z.infer<typeof KiroHookEntrySchema>;

function importCacheTtl(entry: KiroHookEntry): { cacheTtl?: number } {
  if (entry.cache_ttl_seconds === undefined) return {};
  return { cacheTtl: entry.cache_ttl_seconds };
}

/**
 * Extract hooks from the Kiro agent config into canonical format.
 */
function kiroHooksToCanonical(kiroHooks: unknown): HooksConfig["hooks"] {
  if (kiroHooks === null || kiroHooks === undefined || typeof kiroHooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [kiroEventName, entries] of Object.entries(kiroHooks)) {
    const eventName = KIRO_TO_CANONICAL_EVENT_NAMES[kiroEventName] ?? kiroEventName;
    if (!Array.isArray(entries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of entries) {
      const parseResult = KiroHookEntrySchema.safeParse(rawEntry);
      if (!parseResult.success) continue;
      const entry = parseResult.data;
      if (!entry.command) continue;
      defs.push({
        type: "command",
        command: entry.command,
        ...(entry.matcher !== undefined &&
          entry.matcher !== null &&
          entry.matcher !== "" && { matcher: entry.matcher }),
        ...(entry.timeout_ms !== undefined &&
          entry.timeout_ms !== null && { timeout: entry.timeout_ms }),
        ...importCacheTtl(entry),
        ...(entry.name !== undefined && entry.name !== null && { name: entry.name }),
        ...(entry.description !== undefined &&
          entry.description !== null && { description: entry.description }),
      });
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}

/**
 * Hooks generator for the deprecated `kiro` alias: the embedded hook block of
 * `.kiro/agents/default.json`.
 *
 * Kiro's hooks migration guide states this format "does not work in 3.0", so
 * the `kiro-cli` target writes the standalone `.kiro/hooks/*.json` v1 format
 * instead ({@link import("./kiro-cli-hooks.js").KiroCliHooks}). It is kept here
 * so an existing agent config still round-trips.
 *
 * @see https://kiro.dev/docs/cli/v3/hooks-migration/
 */
export class KiroHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return { relativeDirPath: KIRO_AGENTS_DIR_PATH, relativeFilePath: KIRO_HOOKS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<KiroHooks> {
    const paths = KiroHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new KiroHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<KiroHooks> {
    const paths = KiroHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    const config = rulesyncHooks.getJson();
    const kiroHooks = canonicalToKiroHooks({ config, logger });
    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "hooks",
      existingContent,
      patch: { hooks: kiroHooks },
      filePath,
    });
    return new KiroHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let agentConfig: { hooks?: unknown };
    try {
      agentConfig = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Kiro hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = kiroHooksToCanonical(agentConfig.hooks);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        // The embedded format has one writer left, so the override key is fixed.
        buildImportedHooksConfig({ hooks, overrideKey: "kiro" }),
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): KiroHooks {
    return new KiroHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
