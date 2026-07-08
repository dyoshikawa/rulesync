import { join } from "node:path";

import { REASONIX_DIR, REASONIX_SETTINGS_FILE_NAME } from "../../constants/reasonix-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_REASONIX_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
  REASONIX_HOOK_EVENTS,
  REASONIX_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * A single hook entry serialized under an event key in `.reasonix/settings.json`.
 * Unlike Claude Code, Reasonix does not wrap entries in `{ matcher, hooks: [...] }`
 * groups — each event key maps directly to a flat array of these objects.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/DESKTOP_HOOKS.zh-CN.md
 */
type ReasonixHookEntry = {
  match?: string;
  command: string;
  description?: string;
  timeout?: number;
};

/**
 * Only PreToolUse/PostToolUse honor the `match` field (an anchored regex
 * against the tool name); it is ignored on every other event.
 */
const REASONIX_MATCHER_EVENTS: ReadonlySet<string> = new Set(["PreToolUse", "PostToolUse"]);

const SUPPORTED_REASONIX_EVENTS: ReadonlySet<string> = new Set(REASONIX_HOOK_EVENTS);

/**
 * Convert canonical hooks config to the Reasonix `hooks` object.
 * Filters shared hooks to REASONIX_HOOK_EVENTS, merges `config.reasonix?.hooks`,
 * then maps event names and emits flat per-event hook-entry arrays.
 */
function canonicalToReasonixHooks({
  config,
  toolOverrideHooks,
  logger,
}: {
  config: HooksConfig;
  toolOverrideHooks: HooksConfig["hooks"] | undefined;
  logger?: Logger;
}): Record<string, ReasonixHookEntry[]> {
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (SUPPORTED_REASONIX_EVENTS.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = { ...sharedHooks, ...toolOverrideHooks };

  const result: Record<string, ReasonixHookEntry[]> = {};
  for (const [event, defs] of Object.entries(effectiveHooks)) {
    if (!SUPPORTED_REASONIX_EVENTS.has(event)) {
      continue;
    }
    const reasonixEvent = CANONICAL_TO_REASONIX_EVENT_NAMES[event] ?? event;
    const isMatcherEvent = REASONIX_MATCHER_EVENTS.has(reasonixEvent);
    const entries: ReasonixHookEntry[] = [];
    for (const def of defs) {
      if ((def.type ?? "command") !== "command") {
        // Reasonix hooks always run a shell command; other canonical hook
        // types (prompt/http) have no Reasonix equivalent.
        continue;
      }
      if (typeof def.command !== "string") {
        continue;
      }
      const entry: ReasonixHookEntry = { command: def.command };
      if (typeof def.matcher === "string" && def.matcher !== "") {
        if (isMatcherEvent) {
          entry.match = def.matcher;
        } else {
          logger?.warn(
            `matcher "${def.matcher}" on "${event}" hook will be ignored — Reasonix's "${reasonixEvent}" event does not support matchers`,
          );
        }
      }
      if (typeof def.description === "string" && def.description !== "") {
        entry.description = def.description;
      }
      if (typeof def.timeout === "number") {
        // Canonical `timeout` is documented in seconds (see docs/reference/file-formats.md),
        // while Reasonix's `timeout` field is milliseconds, so convert.
        entry.timeout = Math.round(def.timeout * 1000);
      }
      entries.push(entry);
    }
    if (entries.length > 0) {
      result[reasonixEvent] = [...(result[reasonixEvent] ?? []), ...entries];
    }
  }
  return result;
}

/**
 * Reverse {@link canonicalToReasonixHooks}: parse the Reasonix `hooks` object
 * back into a canonical event -> definition[] record.
 */
function reasonixHooksToCanonical(hooks: unknown): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  if (hooks === null || hooks === undefined || typeof hooks !== "object" || Array.isArray(hooks)) {
    return canonical;
  }
  for (const [reasonixEvent, rawEntries] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(rawEntries)) {
      continue;
    }
    const canonicalEvent = REASONIX_TO_CANONICAL_EVENT_NAMES[reasonixEvent] ?? reasonixEvent;
    const defs: HookDefinition[] = [];
    for (const rawEntry of rawEntries) {
      if (rawEntry === null || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        continue;
      }
      const entry = rawEntry as Record<string, unknown>;
      if (typeof entry.command !== "string") {
        continue;
      }
      const def: HookDefinition = { type: "command", command: entry.command };
      if (typeof entry.match === "string" && entry.match !== "") {
        def.matcher = entry.match;
      }
      if (typeof entry.description === "string" && entry.description !== "") {
        def.description = entry.description;
      }
      if (typeof entry.timeout === "number") {
        def.timeout = entry.timeout / 1000;
      }
      defs.push(def);
    }
    if (defs.length > 0) {
      canonical[canonicalEvent] = [...(canonical[canonicalEvent] ?? []), ...defs];
    }
  }
  return canonical;
}

/**
 * Reasonix hooks adapter.
 *
 * Reasonix hooks live in a Claude-Code-style but standalone JSON file —
 * `.reasonix/settings.json` (project) or `~/.reasonix/settings.json`
 * (global) — separate from the `[permissions]`/`[[plugins]]` TOML config.
 * Only the four events documented in the upstream issue are mapped:
 * PreToolUse/PostToolUse/UserPromptSubmit/Stop (see REASONIX_HOOK_EVENTS).
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/DESKTOP_HOOKS.zh-CN.md
 */
export class ReasonixHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // settings.json is not documented as holding anything besides hooks today,
    // but treat it conservatively (like claudecode-hooks.ts) in case future
    // Reasonix versions add other keys to the same file.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Both project and global scope use the same `.reasonix/` relative dir;
    // the processor supplies the home directory as outputRoot in global mode.
    return { relativeDirPath: REASONIX_DIR, relativeFilePath: REASONIX_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<ReasonixHooks> {
    const paths = ReasonixHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new ReasonixHooks({
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
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<ReasonixHooks> {
    const paths = ReasonixHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Reasonix settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const reasonixHooks = canonicalToReasonixHooks({
      config,
      toolOverrideHooks: config.reasonix?.hooks,
      logger,
    });
    const merged = { ...settings, hooks: reasonixHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new ReasonixHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let settings: { hooks?: unknown };
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Reasonix hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = reasonixHooksToCanonical(settings.hooks);
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
  }: ToolHooksForDeletionParams): ReasonixHooks {
    return new ReasonixHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
