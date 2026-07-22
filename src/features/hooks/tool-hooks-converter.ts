import { posix, win32 } from "node:path";

import { type HookEvent, type HookType, type HooksConfig, isHookEvent } from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import { compact } from "../../utils/object.js";

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
  supportedHookTypes?: ReadonlySet<HookType>;
  passthroughFields?: ReadonlyArray<"name" | "description">;
  /**
   * Per-hook boolean fields to carry through the round-trip, each mapping a
   * canonical {@link HookDefinitionSchema} boolean field to its tool-side field
   * name (which may differ — e.g. Junie's `blockOnError` ↔ canonical
   * `failClosed`). Only boolean values are emitted on export and imported back;
   * any other value is ignored so a malformed field can't leak through.
   */
  booleanPassthroughFields?: ReadonlyArray<{
    readonly canonical: "failClosed" | "async";
    readonly tool: string;
  }>;
  /**
   * Per-hook string fields to carry through the round-trip, each mapping a
   * canonical {@link HookDefinitionSchema} string field to its tool-side field
   * name. Only non-empty string values are emitted on export and imported back;
   * any other value is ignored so a malformed field can't leak through. Used
   * for tool-specific opaque strings such as Claude Code's `if` condition.
   */
  stringPassthroughFields?: ReadonlyArray<{
    readonly canonical: "if";
    readonly tool: string;
  }>;
  /**
   * When true, only dot-relative commands (e.g. ./script.sh, ../script.sh, .rulesync/hooks/x.sh)
   * are prefixed with projectDirVar. Bare executable commands like `npx prettier ...` are left intact.
   */
  prefixDotRelativeCommandsOnly?: boolean;
  /**
   * When true, prompt/agent hooks emit the canonical `model` field. Only tools
   * that document a per-hook model selector (Claude Code) should opt in —
   * other prompt-capable tools (Factory Droid, Devin) do not document the
   * field, so it must not leak into their generated configs.
   */
  emitsPromptModel?: boolean;
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
  const unquotedCommand = trimmedCommand?.replace(/^["']/, "");
  const isAbsoluteCommand =
    typeof unquotedCommand === "string" &&
    (posix.isAbsolute(unquotedCommand) ||
      win32.isAbsolute(unquotedCommand) ||
      unquotedCommand.startsWith("~/"));
  const shouldPrefix =
    converterConfig.projectDirVar !== "" &&
    typeof trimmedCommand === "string" &&
    !trimmedCommand.startsWith("$") &&
    !isAbsoluteCommand &&
    (!converterConfig.prefixDotRelativeCommandsOnly || trimmedCommand.startsWith("."));

  // Only the variable itself is quoted (not the whole command) so a project path
  // containing a space can't be word-split by the shell, while any trailing
  // arguments after the script path stay outside the quotes and still split normally.
  return shouldPrefix && typeof trimmedCommand === "string"
    ? `"${converterConfig.projectDirVar}"/${trimmedCommand.replace(/^\.\//, "")}`
    : def.command;
}

/**
 * Emit the configured boolean passthrough fields on the tool side, mapping each
 * canonical field name to its (possibly renamed) tool field name. Only boolean
 * values are carried through.
 */
function emitBooleanPassthroughFields({
  def,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  converterConfig: ToolHooksConverterConfig;
}): Record<string, boolean> {
  return Object.fromEntries(
    (converterConfig.booleanPassthroughFields ?? [])
      .filter(({ canonical }) => typeof def[canonical] === "boolean")
      .map(({ canonical, tool }) => [tool, def[canonical] as boolean]),
  );
}

/**
 * Import the configured boolean passthrough fields back into canonical fields,
 * reversing {@link emitBooleanPassthroughFields}. Only boolean values are read.
 */
function importBooleanPassthroughFields({
  h,
  converterConfig,
}: {
  h: Record<string, unknown>;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, boolean> {
  return Object.fromEntries(
    (converterConfig.booleanPassthroughFields ?? [])
      .filter(({ tool }) => typeof h[tool] === "boolean")
      .map(({ canonical, tool }) => [canonical, h[tool] as boolean]),
  );
}

/**
 * Emit the configured string passthrough fields on the tool side, mapping each
 * canonical field name to its (possibly renamed) tool field name. Only non-empty
 * string values are carried through.
 */
function emitStringPassthroughFields({
  def,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  converterConfig: ToolHooksConverterConfig;
}): Record<string, string> {
  return Object.fromEntries(
    (converterConfig.stringPassthroughFields ?? [])
      .filter(({ canonical }) => typeof def[canonical] === "string" && def[canonical] !== "")
      .map(({ canonical, tool }) => [tool, def[canonical] as string]),
  );
}

/**
 * Import the configured string passthrough fields back into canonical fields,
 * reversing {@link emitStringPassthroughFields}. Only non-empty string values
 * are read.
 */
function importStringPassthroughFields({
  h,
  converterConfig,
}: {
  h: Record<string, unknown>;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, string> {
  return Object.fromEntries(
    (converterConfig.stringPassthroughFields ?? [])
      .filter(({ tool }) => typeof h[tool] === "string" && h[tool] !== "")
      .map(({ canonical, tool }) => [canonical, h[tool] as string]),
  );
}

/**
 * Emit the payload fields specific to a hook type — `url`/`headers`/
 * `allowedEnvVars` for http, `server`/`tool`/`input` for mcp_tool, `model`
 * for prompt/agent. https://code.claude.com/docs/en/hooks
 */
function emitTypePayloadFields({
  def,
  hookType,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, unknown> {
  if (hookType === "http") {
    return compact({ url: def.url, headers: def.headers, allowedEnvVars: def.allowedEnvVars });
  }
  if (hookType === "mcp_tool") {
    return compact({ server: def.server, tool: def.tool, input: def.input });
  }
  if ((hookType === "prompt" || hookType === "agent") && converterConfig.emitsPromptModel) {
    return compact({ model: def.model });
  }
  return {};
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
      // Spread the boolean and string passthrough fields first so the
      // explicitly-handled core fields below always win: a misconfigured `tool`
      // name (e.g. mapping onto "type"/"command") can never silently shadow them.
      ...emitBooleanPassthroughFields({ def, converterConfig }),
      ...emitStringPassthroughFields({ def, converterConfig }),
      type: hookType,
      ...(command !== undefined && command !== null && { command }),
      ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
      ...(def.prompt !== undefined && def.prompt !== null && { prompt: def.prompt }),
      // Type-specific payload fields (https://code.claude.com/docs/en/hooks).
      // Gated per type so e.g. an `url` authored on a command hook never
      // leaks into the generated config.
      ...emitTypePayloadFields({ def, hookType, converterConfig }),
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
  if (converterConfig.projectDirVar === "" || typeof cmd !== "string") {
    return cmd;
  }
  const quotedPrefix = `"${converterConfig.projectDirVar}"/`;
  if (cmd.startsWith(quotedPrefix)) {
    return `./${cmd.slice(quotedPrefix.length)}`;
  }
  if (cmd.includes(`${converterConfig.projectDirVar}/`)) {
    const escapedVar = converterConfig.projectDirVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return cmd.replace(new RegExp(`^${escapedVar}\\/?`), "./");
  }
  return cmd;
}

/**
 * Hook types preserved verbatim on import — Claude Code's five documented
 * handler types. Anything else is coerced to `command` as before.
 * https://code.claude.com/docs/en/hooks
 */
const IMPORTED_HOOK_TYPES = new Set<HookType>(["command", "prompt", "http", "mcp_tool", "agent"]);

function isImportedHookType(value: unknown): value is HookType {
  return typeof value === "string" && IMPORTED_HOOK_TYPES.has(value as HookType);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Import the payload fields specific to a hook type, type-checking each raw
 * value before it enters the canonical definition.
 */
function importTypePayloadFields({
  h,
  hookType,
}: {
  h: Record<string, unknown>;
  hookType: HookType;
}): Partial<HooksConfig["hooks"][string][number]> {
  if (hookType === "http") {
    return {
      ...(typeof h.url === "string" && { url: h.url }),
      ...(isStringRecord(h.headers) && { headers: h.headers }),
      ...(isStringArray(h.allowedEnvVars) && { allowedEnvVars: h.allowedEnvVars }),
    };
  }
  if (hookType === "mcp_tool") {
    return {
      ...(typeof h.server === "string" && { server: h.server }),
      ...(typeof h.tool === "string" && { tool: h.tool }),
      ...(h.input !== null &&
        typeof h.input === "object" &&
        !Array.isArray(h.input) && { input: h.input as Record<string, unknown> }),
    };
  }
  if (hookType === "prompt" || hookType === "agent") {
    return typeof h.model === "string" ? { model: h.model } : {};
  }
  return {};
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
  const hookType = isImportedHookType(h.type) ? h.type : "command";
  const timeout = typeof h.timeout === "number" ? h.timeout : undefined;
  const prompt = typeof h.prompt === "string" ? h.prompt : undefined;
  return {
    type: hookType,
    ...(command !== undefined && command !== null && { command }),
    ...(timeout !== undefined && timeout !== null && { timeout }),
    ...(prompt !== undefined && prompt !== null && { prompt }),
    // Type-specific payload fields, preserved so http/mcp_tool/agent hooks
    // found in an existing settings file round-trip instead of silently
    // degrading to broken command hooks.
    ...importTypePayloadFields({ h, hookType }),
    ...(converterConfig.passthroughFields?.includes("name") &&
      typeof h.name === "string" && { name: h.name }),
    ...(converterConfig.passthroughFields?.includes("description") &&
      typeof h.description === "string" && { description: h.description }),
    ...importBooleanPassthroughFields({ h, converterConfig }),
    ...importStringPassthroughFields({ h, converterConfig }),
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

/**
 * Assemble the canonical hooks config a tool importer writes to
 * `.rulesync/hooks.json`.
 *
 * The top-level `hooks` record only accepts canonical event names, so any
 * imported native event key without a canonical mapping is moved under the
 * importing tool's own override block (`<overrideKey>.hooks`), whose keys stay
 * lenient. This mirrors the generate direction — override blocks pass
 * tool-native keys through verbatim — so documented native triggers (e.g.
 * kiro-ide's `PostFileSave`) survive an import → generate round-trip instead
 * of failing canonical validation.
 */
export function buildImportedHooksConfig({
  hooks,
  overrideKey,
  version = 1,
  extraOverride,
}: {
  hooks: HooksConfig["hooks"];
  overrideKey: string;
  version?: number;
  extraOverride?: Record<string, unknown>;
}): HooksConfig {
  const canonical: HooksConfig["hooks"] = {};
  const native: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(hooks)) {
    if (isHookEvent(event)) {
      canonical[event] = defs;
    } else {
      native[event] = defs;
    }
  }
  const override: Record<string, unknown> = { ...extraOverride };
  if (Object.keys(native).length > 0) {
    override.hooks = native;
  }
  const config: HooksConfig = { version, hooks: canonical };
  if (Object.keys(override).length > 0) {
    (config as Record<string, unknown>)[overrideKey] = override;
  }
  return config;
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
