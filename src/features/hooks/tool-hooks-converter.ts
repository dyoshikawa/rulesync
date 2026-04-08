import type { HookEvent, HooksConfig } from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";

type ToolMatcherEntry = {
  matcher?: string;
  hooks?: Array<Record<string, unknown>>;
};

function isToolMatcherEntry(x: unknown): x is ToolMatcherEntry {
  if (x === null || typeof x !== "object") {
    return false;
  }
  if ("matcher" in x && typeof x.matcher !== "string") {
    return false;
  }
  if ("hooks" in x && !Array.isArray(x.hooks)) {
    return false;
  }
  return true;
}

export type ToolHooksConverterConfig = {
  supportedEvents: readonly HookEvent[];
  canonicalToToolEventNames: Record<string, string>;
  toolToCanonicalEventNames: Record<string, string>;
  /**
   * Variable name (e.g. `$CLAUDE_PROJECT_DIR`) used to prefix dot-relative commands so the
   * tool can resolve them relative to the project root. Set to an empty string to disable
   * prefixing entirely (e.g. for tools like Codex CLI that have no such variable).
   */
  projectDirVar: string;
  /**
   * When true, only dot-relative commands (e.g. ./script.sh, ../script.sh, .rulesync/hooks/x.sh)
   * are prefixed with projectDirVar. Bare executable commands like `npx prettier ...` are left intact.
   */
  prefixDotRelativeCommandsOnly?: boolean;
  /**
   * Events that do not support the `matcher` field. Any matcher defined on these events
   * will be silently dropped with a warning during export.
   */
  noMatcherEvents?: ReadonlySet<string>;
  /**
   * If specified, hooks whose `type` is not in this set are silently filtered out on
   * export. Used by tools that only accept a subset of canonical hook types (e.g. Codex CLI
   * only supports `command`).
   *
   * Note: the inverse direction (`toolHooksToCanonical`) intentionally does NOT enforce
   * this filter — silently dropping data on import causes round-trip data loss. Such hooks
   * are preserved in canonical form and only filtered on the next export, where the
   * `hooks-processor.ts` warning makes the loss visible to the user.
   */
  supportedHookTypes?: ReadonlySet<string>;
  /**
   * If true, events whose entries become empty after type filtering are omitted from the
   * output entirely (rather than emitted as an empty array). Required by tools whose
   * config schema rejects empty event arrays.
   */
  omitEmptyEvents?: boolean;
};

/**
 * Convert canonical hooks config to tool-specific format (shared by Claude and Factory Droid).
 * Uses explicit event name mapping tables rather than algorithmic case conversion,
 * since tool event names may differ entirely from canonical names
 * (e.g. beforeSubmitPrompt → UserPromptSubmit).
 */
export function canonicalToToolHooks({
  config,
  toolOverrideHooks,
  converterConfig,
  logger,
}: {
  config: HooksConfig;
  toolOverrideHooks: HooksConfig["hooks"] | undefined;
  converterConfig: ToolHooksConverterConfig;
  logger?: Logger;
}): Record<string, unknown[]> {
  const supported: Set<string> = new Set(converterConfig.supportedEvents);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    ...toolOverrideHooks,
  };
  const result: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const toolEventName = converterConfig.canonicalToToolEventNames[eventName] ?? eventName;
    const byMatcher = new Map<string, HooksConfig["hooks"][string]>();
    for (const def of definitions) {
      const key = def.matcher ?? "";
      const list = byMatcher.get(key);
      if (list) list.push(def);
      else byMatcher.set(key, [def]);
    }
    const entries: unknown[] = [];
    const isNoMatcherEvent = converterConfig.noMatcherEvents?.has(eventName) ?? false;
    const hookTypeFilter = converterConfig.supportedHookTypes;
    const prefixingEnabled = converterConfig.projectDirVar !== "";
    for (const [matcherKey, defs] of byMatcher) {
      if (isNoMatcherEvent && matcherKey) {
        logger?.warn(
          `matcher "${matcherKey}" on "${eventName}" hook will be ignored — this event does not support matchers`,
        );
      }
      const filteredDefs = hookTypeFilter
        ? defs.filter((def) => hookTypeFilter.has(def.type ?? "command"))
        : defs;
      if (filteredDefs.length === 0) continue;
      const hooks = filteredDefs.map((def) => {
        const commandText = def.command;
        const trimmedCommand =
          typeof commandText === "string" ? commandText.trimStart() : undefined;
        const shouldPrefix =
          prefixingEnabled &&
          typeof trimmedCommand === "string" &&
          !trimmedCommand.startsWith("$") &&
          (!converterConfig.prefixDotRelativeCommandsOnly || trimmedCommand.startsWith("."));

        const command =
          shouldPrefix && typeof trimmedCommand === "string"
            ? `${converterConfig.projectDirVar}/${trimmedCommand.replace(/^\.\//, "")}`
            : def.command;
        return {
          type: def.type ?? "command",
          ...(command !== undefined && command !== null && { command }),
          ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
          ...(def.prompt !== undefined && def.prompt !== null && { prompt: def.prompt }),
          ...(def.name !== undefined && def.name !== null && { name: def.name }),
          ...(def.description !== undefined &&
            def.description !== null && { description: def.description }),
        };
      });
      const includeMatcher = matcherKey && !isNoMatcherEvent;
      entries.push(includeMatcher ? { matcher: matcherKey, hooks } : { hooks });
    }
    if (entries.length === 0 && converterConfig.omitEmptyEvents) continue;
    result[toolEventName] = entries;
  }
  return result;
}

/**
 * Convert tool-specific hooks back to canonical format (shared by Claude and Factory Droid).
 * Reverses event name mapping and strips project directory variable prefix from commands.
 *
 * Note: This function does not strip matchers for noMatcherEvents. Tools themselves never produce
 * matchers on these events, so stripping is unnecessary on import. If a manually edited config
 * includes a matcher on such an event, it will be preserved in canonical format but dropped
 * on the next export (with a warning).
 */
export function toolHooksToCanonical({
  hooks,
  converterConfig,
}: {
  hooks: unknown;
  converterConfig: ToolHooksConverterConfig;
}): HooksConfig["hooks"] {
  if (hooks === null || hooks === undefined || typeof hooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [toolEventName, matcherEntries] of Object.entries(hooks)) {
    const eventName = converterConfig.toolToCanonicalEventNames[toolEventName] ?? toolEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of matcherEntries) {
      if (!isToolMatcherEntry(rawEntry)) continue;
      const hookDefs = rawEntry.hooks ?? [];
      for (const h of hookDefs) {
        const cmd = typeof h.command === "string" ? h.command : undefined;
        const prefixingEnabled = converterConfig.projectDirVar !== "";
        const command =
          prefixingEnabled &&
          typeof cmd === "string" &&
          cmd.includes(`${converterConfig.projectDirVar}/`)
            ? cmd.replace(
                new RegExp(
                  `^${converterConfig.projectDirVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/?`,
                ),
                "./",
              )
            : cmd;
        const hookType = h.type === "command" || h.type === "prompt" ? h.type : "command";
        const timeout = typeof h.timeout === "number" ? h.timeout : undefined;
        const prompt = typeof h.prompt === "string" ? h.prompt : undefined;
        const name = typeof h.name === "string" ? h.name : undefined;
        const description = typeof h.description === "string" ? h.description : undefined;
        defs.push({
          type: hookType,
          ...(command !== undefined && command !== null && { command }),
          ...(timeout !== undefined && timeout !== null && { timeout }),
          ...(prompt !== undefined && prompt !== null && { prompt }),
          ...(name !== undefined && name !== null && { name }),
          ...(description !== undefined && description !== null && { description }),
          ...(rawEntry.matcher !== undefined &&
            rawEntry.matcher !== null &&
            rawEntry.matcher !== "" && { matcher: rawEntry.matcher }),
        });
      }
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}
