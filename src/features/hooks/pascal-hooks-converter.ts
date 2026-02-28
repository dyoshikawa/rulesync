import type { HookEvent, HooksConfig } from "../../types/hooks.js";

type PascalMatcherEntry = {
  matcher?: string;
  hooks?: Array<Record<string, unknown>>;
};

function isPascalMatcherEntry(x: unknown): x is PascalMatcherEntry {
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

export type PascalHooksConverterConfig = {
  supportedEvents: readonly HookEvent[];
  canonicalToToolEventNames: Record<string, string>;
  toolToCanonicalEventNames: Record<string, string>;
  projectDirVar: string;
};

/**
 * Convert canonical hooks config to PascalCase tool format (shared by Claude and Factory Droid).
 * Filters to supported events, merges tool-specific overrides,
 * converts event names, prefixes commands, and groups by matcher.
 */
export function canonicalToPascalHooks({
  config,
  toolOverrideHooks,
  converterConfig,
}: {
  config: HooksConfig;
  toolOverrideHooks: HooksConfig["hooks"] | undefined;
  converterConfig: PascalHooksConverterConfig;
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
    const pascalEventName = converterConfig.canonicalToToolEventNames[eventName] ?? eventName;
    const byMatcher = new Map<string, HooksConfig["hooks"][string]>();
    for (const def of definitions) {
      const key = def.matcher ?? "";
      const list = byMatcher.get(key);
      if (list) list.push(def);
      else byMatcher.set(key, [def]);
    }
    const entries: unknown[] = [];
    for (const [matcherKey, defs] of byMatcher) {
      const hooks = defs.map((def) => {
        const command =
          def.command !== undefined && def.command !== null && !def.command.startsWith("$")
            ? `${converterConfig.projectDirVar}/${def.command.replace(/^\.\//, "")}`
            : def.command;
        return {
          type: def.type ?? "command",
          ...(command !== undefined && command !== null && { command }),
          ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
          ...(def.prompt !== undefined && def.prompt !== null && { prompt: def.prompt }),
        };
      });
      entries.push(matcherKey ? { matcher: matcherKey, hooks } : { hooks });
    }
    result[pascalEventName] = entries;
  }
  return result;
}

/**
 * Convert PascalCase tool hooks back to canonical format (shared by Claude and Factory Droid).
 * Reverses event name mapping and strips project directory variable prefix from commands.
 */
export function pascalHooksToCanonical({
  hooks,
  converterConfig,
}: {
  hooks: unknown;
  converterConfig: PascalHooksConverterConfig;
}): HooksConfig["hooks"] {
  if (hooks === null || hooks === undefined || typeof hooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [pascalEventName, matcherEntries] of Object.entries(hooks)) {
    const eventName = converterConfig.toolToCanonicalEventNames[pascalEventName] ?? pascalEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of matcherEntries) {
      if (!isPascalMatcherEntry(rawEntry)) continue;
      const entry = rawEntry;
      const hookDefs = entry.hooks ?? [];
      for (const h of hookDefs) {
        const cmd = typeof h.command === "string" ? h.command : undefined;
        const command =
          typeof cmd === "string" && cmd.includes(`${converterConfig.projectDirVar}/`)
            ? cmd.replace(new RegExp(`^\\${converterConfig.projectDirVar}\\/?`), "./")
            : cmd;
        const hookType = h.type === "command" || h.type === "prompt" ? h.type : "command";
        const timeout = typeof h.timeout === "number" ? h.timeout : undefined;
        const prompt = typeof h.prompt === "string" ? h.prompt : undefined;
        defs.push({
          type: hookType,
          ...(command !== undefined && command !== null && { command }),
          ...(timeout !== undefined && timeout !== null && { timeout }),
          ...(prompt !== undefined && prompt !== null && { prompt }),
          ...(entry.matcher !== undefined &&
            entry.matcher !== null &&
            entry.matcher !== "" && { matcher: entry.matcher }),
        });
      }
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}
