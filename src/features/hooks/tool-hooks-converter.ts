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
  projectDirVar: string;
  supportedHookTypes?: ReadonlySet<"command" | "prompt" | "http">;
  passthroughFields?: ReadonlyArray<"name" | "description">;
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
};

/**
 * Filter the shared canonical hooks to the supported events and merge tool overrides on top.
 */
function buildEffectiveHooks({
  config,
  toolOverrideHooks,
  supportedEvents,
}: {
  config: HooksConfig;
  toolOverrideHooks: HooksConfig["hooks"] | undefined;
  supportedEvents: readonly HookEvent[];
}): HooksConfig["hooks"] {
  const supported: Set<string> = new Set(supportedEvents);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  return {
    ...sharedHooks,
    ...toolOverrideHooks,
  };
}

/**
 * Group a list of hook definitions by their `matcher` (empty string when absent),
 * preserving insertion order of both keys and grouped definitions.
 */
function groupDefinitionsByMatcher(
  definitions: HooksConfig["hooks"][string],
): Map<string, HooksConfig["hooks"][string]> {
  const byMatcher = new Map<string, HooksConfig["hooks"][string]>();
  for (const def of definitions) {
    const key = def.matcher ?? "";
    const list = byMatcher.get(key);
    if (list) list.push(def);
    else byMatcher.set(key, [def]);
  }
  return byMatcher;
}

/**
 * Apply the optional project directory variable prefix to a command string.
 */
function applyCommandPrefix({
  def,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  converterConfig: ToolHooksConverterConfig;
}): unknown {
  const commandText = def.command;
  const trimmedCommand = typeof commandText === "string" ? commandText.trimStart() : undefined;
  const shouldPrefix =
    converterConfig.projectDirVar !== "" &&
    typeof trimmedCommand === "string" &&
    !trimmedCommand.startsWith("$") &&
    (!converterConfig.prefixDotRelativeCommandsOnly || trimmedCommand.startsWith("."));

  return shouldPrefix && typeof trimmedCommand === "string"
    ? `${converterConfig.projectDirVar}/${trimmedCommand.replace(/^\.\//, "")}`
    : def.command;
}

/**
 * Convert the definitions of a single matcher group into tool hook entries,
 * honoring supported hook types and passthrough fields.
 */
function buildToolHooks({
  defs,
  converterConfig,
}: {
  defs: HooksConfig["hooks"][string];
  converterConfig: ToolHooksConverterConfig;
}): Array<Record<string, unknown>> {
  const hooks: Array<Record<string, unknown>> = [];
  for (const def of defs) {
    const hookType = def.type ?? "command";
    if (converterConfig.supportedHookTypes && !converterConfig.supportedHookTypes.has(hookType)) {
      continue;
    }
    const command = applyCommandPrefix({ def, converterConfig });
    hooks.push({
      type: hookType,
      ...(command !== undefined && command !== null && { command }),
      ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
      ...(def.prompt !== undefined && def.prompt !== null && { prompt: def.prompt }),
      ...(converterConfig.passthroughFields?.includes("name") &&
        def.name !== undefined &&
        def.name !== null && { name: def.name }),
      ...(converterConfig.passthroughFields?.includes("description") &&
        def.description !== undefined &&
        def.description !== null && { description: def.description }),
    });
  }
  return hooks;
}

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
  const effectiveHooks = buildEffectiveHooks({
    config,
    toolOverrideHooks,
    supportedEvents: converterConfig.supportedEvents,
  });
  const result: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const toolEventName = converterConfig.canonicalToToolEventNames[eventName] ?? eventName;
    const byMatcher = groupDefinitionsByMatcher(definitions);
    const entries: unknown[] = [];
    const isNoMatcherEvent = converterConfig.noMatcherEvents?.has(eventName) ?? false;
    for (const [matcherKey, defs] of byMatcher) {
      if (isNoMatcherEvent && matcherKey) {
        logger?.warn(
          `matcher "${matcherKey}" on "${eventName}" hook will be ignored — this event does not support matchers`,
        );
      }
      const hooks = buildToolHooks({ defs, converterConfig });
      if (hooks.length === 0) {
        continue;
      }
      const includeMatcher = matcherKey && !isNoMatcherEvent;
      entries.push(includeMatcher ? { matcher: matcherKey, hooks } : { hooks });
    }
    if (entries.length > 0) {
      result[toolEventName] = entries;
    }
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
/**
 * Strip the project directory variable prefix from a tool command string,
 * converting it back to a `./`-relative command.
 */
function stripCommandPrefix({
  command,
  converterConfig,
}: {
  command: unknown;
  converterConfig: ToolHooksConverterConfig;
}): string | undefined {
  const cmd = typeof command === "string" ? command : undefined;
  if (
    converterConfig.projectDirVar !== "" &&
    typeof cmd === "string" &&
    cmd.includes(`${converterConfig.projectDirVar}/`)
  ) {
    return cmd.replace(
      new RegExp(`^${converterConfig.projectDirVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/?`),
      "./",
    );
  }
  return cmd;
}

/**
 * Convert a single tool hook record into a canonical hook definition.
 */
function toolHookToCanonical({
  h,
  rawEntry,
  converterConfig,
}: {
  h: Record<string, unknown>;
  rawEntry: ToolMatcherEntry;
  converterConfig: ToolHooksConverterConfig;
}): HooksConfig["hooks"][string][number] {
  const command = stripCommandPrefix({ command: h.command, converterConfig });
  const hookType = h.type === "command" || h.type === "prompt" ? h.type : "command";
  const timeout = typeof h.timeout === "number" ? h.timeout : undefined;
  const prompt = typeof h.prompt === "string" ? h.prompt : undefined;
  return {
    type: hookType,
    ...(command !== undefined && command !== null && { command }),
    ...(timeout !== undefined && timeout !== null && { timeout }),
    ...(prompt !== undefined && prompt !== null && { prompt }),
    ...(converterConfig.passthroughFields?.includes("name") &&
      typeof h.name === "string" && { name: h.name }),
    ...(converterConfig.passthroughFields?.includes("description") &&
      typeof h.description === "string" && { description: h.description }),
    ...(rawEntry.matcher !== undefined &&
      rawEntry.matcher !== null &&
      rawEntry.matcher !== "" && { matcher: rawEntry.matcher }),
  };
}

/**
 * Convert a single tool matcher entry into canonical hook definitions.
 */
function toolMatcherEntryToCanonical({
  rawEntry,
  converterConfig,
}: {
  rawEntry: ToolMatcherEntry;
  converterConfig: ToolHooksConverterConfig;
}): HooksConfig["hooks"][string] {
  const hookDefs = rawEntry.hooks ?? [];
  return hookDefs.map((h) => toolHookToCanonical({ h, rawEntry, converterConfig }));
}

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
      defs.push(...toolMatcherEntryToCanonical({ rawEntry, converterConfig }));
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}
