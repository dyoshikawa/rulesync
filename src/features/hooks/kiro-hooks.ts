import { join } from "node:path";

import { z } from "zod/mini";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  KIRO_HOOK_EVENTS,
  CANONICAL_TO_KIRO_EVENT_NAMES,
  KIRO_TO_CANONICAL_EVENT_NAMES,
  safeString,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Convert canonical hooks config to Kiro CLI format.
 * Filters shared hooks to KIRO_HOOK_EVENTS, merges config.kiro?.hooks,
 * then maps event names and emits Kiro CLI hook arrays.
 */
function canonicalToKiroHooks(config: HooksConfig): Record<string, unknown[]> {
  const kiroSupported: Set<string> = new Set(KIRO_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (kiroSupported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    // Note: Tool-specific overrides (config.kiro?.hooks) bypass the
    // KIRO_HOOK_EVENTS filter by design — users who define tool-level overrides
    // are expected to know the target tool's event surface. The HooksProcessor
    // already warns about unsupported events before calling this function.
    ...config.kiro?.hooks,
  };
  const kiro: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const kiroEventName = CANONICAL_TO_KIRO_EVENT_NAMES[eventName] ?? eventName;
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
        ...(def.name !== undefined && def.name !== null && { name: def.name }),
        ...(def.description !== undefined &&
          def.description !== null && { description: def.description }),
      });
    }
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
 * Kiro CLI hook entry as stored in each event's array.
 * Uses `z.looseObject` so that unknown fields added by future Kiro CLI
 * versions are accepted and silently ignored during import.
 */
const KiroHookEntrySchema = z.looseObject({
  command: z.optional(safeString),
  matcher: z.optional(z.string()),
  timeout_ms: z.optional(z.number()),
  name: z.optional(z.string()),
  description: z.optional(z.string()),
});

/**
 * Extract hooks from Kiro CLI agent config into canonical format.
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
    return { relativeDirPath: join(".kiro", "agents"), relativeFilePath: "default.json" };
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<KiroHooks> {
    const paths = KiroHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let agentConfig: Record<string, unknown>;
    try {
      agentConfig = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Kiro agent config at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const kiroHooks = canonicalToKiroHooks(config);
    const merged = { ...agentConfig, hooks: kiroHooks };
    const fileContent = JSON.stringify(merged, null, 2);
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
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
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
