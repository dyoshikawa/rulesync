import { posix, win32 } from "node:path";

import {
  CONTROL_CHARS,
  type HookEvent,
  type HookType,
  type HooksConfig,
  isHookEvent,
} from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import { compact } from "../../utils/object.js";
import { isPlainObject } from "../../utils/type-guards.js";

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
    readonly canonical: "failClosed" | "async" | "once" | "asyncRewake" | "continueOnBlock";
    readonly tool: string;
    /** Emit only on `command` hooks, for a field the tool documents there only. */
    readonly commandOnly?: boolean;
  }>;
  /**
   * Per-hook number fields to carry through the round-trip, each mapping a
   * canonical {@link HookDefinitionSchema} number field to its tool-side field
   * name. Only finite numbers are emitted on export and imported back, so a
   * `NaN`/`Infinity` (which JSON cannot represent) or a numeric string can't
   * leak into a config the tool would reject. Any narrower constraint (an
   * integer, a non-negative one) belongs on the canonical field's schema, which
   * is what an authored value is validated against.
   */
  numberPassthroughFields?: ReadonlyArray<{
    readonly canonical: "additionalContextLimit";
    readonly tool: string;
    /** Emit only on `command` hooks, for a field the tool documents there only. */
    readonly commandOnly?: boolean;
  }>;
  /**
   * Per-hook string fields to carry through the round-trip, each mapping a
   * canonical {@link HookDefinitionSchema} string field to its tool-side field
   * name. Only non-empty string values are emitted on export and imported back;
   * any other value is ignored so a malformed field can't leak through. Used
   * for tool-specific opaque strings such as Claude Code's `if` condition.
   */
  stringPassthroughFields?: ReadonlyArray<{
    readonly canonical: "if" | "statusMessage" | "commandWindows" | "shell";
    readonly tool: string;
    /** Emit only on `command` hooks, for a field the tool documents there only. */
    readonly commandOnly?: boolean;
  }>;
  /**
   * Per-hook string-array fields to carry through the round-trip. Only arrays
   * whose entries are all strings are emitted and imported, so a malformed
   * value cannot leak into a config the tool would reject.
   */
  arrayPassthroughFields?: ReadonlyArray<{
    readonly canonical: "args";
    readonly tool: string;
    /** Emit only on `command` hooks, for a field the tool documents there only. */
    readonly commandOnly?: boolean;
  }>;
  /**
   * Per-hook string-map fields to carry through the round-trip. Only plain
   * objects whose values are all strings are emitted and imported, and a value
   * carrying a newline, carriage return or NUL is refused in both directions:
   * these maps become process environment variables, where a control character
   * is an injection shape rather than data.
   */
  recordPassthroughFields?: ReadonlyArray<{
    readonly canonical: "env";
    readonly tool: string;
    /** Emit only on `command` hooks, for a field the tool documents there only. */
    readonly commandOnly?: boolean;
  }>;
  /**
   * Fields that live on the *matcher group* rather than on a hook. They are
   * stored per definition canonically (the canonical model is a flat list), so
   * export reads the first definition of the group that carries one and import
   * puts it back on every definition of that group.
   */
  groupPassthroughFields?: ReadonlyArray<{
    readonly canonical: "metadata" | "commandRegex";
    readonly tool: string;
    /**
     * The value shape the tool documents. Anything else is ignored in both
     * directions, so an object never reaches a canonical string field (or the
     * reverse) and fails validation later. Defaults to `"object"`.
     */
    readonly valueType?: "object" | "string";
    /**
     * When set, definitions carrying different values are split into separate
     * matcher entries instead of sharing the group's first value. Set it for a
     * field that *restricts* when a hook runs — inheriting a neighboring hook's filter
     * would otherwise stop a hook from firing at all — and leave it off for an
     * additive payload, where sharing only widens what a hook receives.
     */
    readonly subdividesGroup?: boolean;
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
 * Group a list of hook definitions by their `matcher` (empty string when
 * absent), preserving insertion order of both keys and grouped definitions.
 * Definitions that disagree on a `subdividesGroup` passthrough field are split
 * into separate groups, so a restricting field is never inherited by a hook
 * that did not ask for it.
 */
function groupDefinitionsByMatcher({
  definitions,
  converterConfig,
}: {
  definitions: HooksConfig["hooks"][string];
  converterConfig: ToolHooksConverterConfig;
}): Map<string, { matcher: string; defs: HooksConfig["hooks"][string] }> {
  const subdividingFields = (converterConfig.groupPassthroughFields ?? []).filter(
    ({ subdividesGroup }) => subdividesGroup,
  );
  const byMatcher = new Map<string, { matcher: string; defs: HooksConfig["hooks"][string] }>();
  for (const def of definitions) {
    const matcher = def.matcher ?? "";
    const key = [
      matcher,
      // A value the tool cannot express is never emitted, so keying on it would
      // split a group into entries that come out identical. NUL separates the
      // parts because no emitted value may contain one.
      ...subdividingFields.map(({ canonical, valueType }) => {
        const value = def[canonical];
        return isGroupPassthroughValue(value, valueType) ? stableJson(value) : "";
      }),
    ].join("\u0000");
    const group = byMatcher.get(key);
    if (group) group.defs.push(def);
    else byMatcher.set(key, { matcher, defs: [def] });
  }
  return byMatcher;
}

/** `$CLAUDE_PROJECT_DIR` -> `${CLAUDE_PROJECT_DIR}`, the form the tool substitutes. */
function bracePlaceholder(projectDirVar: string): string {
  return `\${${projectDirVar.replace(/^\$/, "")}}`;
}

function stripSurroundingQuotes(value: string): string {
  return value.replace(/^(["'])(.*)\1$/, "$2").replace(/^["']/, "");
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
  const isDotRelativeCommand = unquotedCommand?.startsWith(".") ?? false;
  const isAbsoluteCommand =
    typeof unquotedCommand === "string" &&
    (posix.isAbsolute(unquotedCommand) ||
      win32.isAbsolute(unquotedCommand) ||
      unquotedCommand.startsWith("~/"));
  // The exec form is `args` being *present* — an empty array selects it too,
  // and the docs' own example uses `"args": []`. Only checked for tools that
  // actually emit `args`; for the rest `command` stays a shell string.
  const emitsArgs =
    converterConfig.arrayPassthroughFields?.some(({ canonical }) => canonical === "args") ?? false;
  const isExecForm = emitsArgs && Array.isArray(def.args);
  const shouldPrefix =
    converterConfig.projectDirVar !== "" &&
    typeof trimmedCommand === "string" &&
    !trimmedCommand.startsWith("$") &&
    !isAbsoluteCommand &&
    (!converterConfig.prefixDotRelativeCommandsOnly || isDotRelativeCommand);

  // Only the variable itself is quoted (not the whole command) so a project path
  // containing a space can't be word-split by the shell, while any trailing
  // arguments after the script path stay outside the quotes and still split normally.
  if (!shouldPrefix || typeof trimmedCommand !== "string") {
    return def.command;
  }

  // Keep a leading quote around paths containing spaces, but remove `./`
  // inside it so the quoted project root and quoted relative path concatenate
  // into one shell word: "$PROJECT_DIR"/"scripts/my hook.sh".
  const relativeCommand = trimmedCommand.replace(/^(["'])\.\//, "$1").replace(/^\.\//, "");
  if (isExecForm) {
    // No shell here, so the quotes would become part of the file name. The
    // braced placeholder is what the tool substitutes itself, and it needs no
    // quoting because each argument is passed through verbatim.
    return `${bracePlaceholder(converterConfig.projectDirVar)}/${stripSurroundingQuotes(relativeCommand)}`;
  }
  return `"${converterConfig.projectDirVar}"/${relativeCommand}`;
}

/**
 * Emit the configured boolean passthrough fields on the tool side, mapping each
 * canonical field name to its (possibly renamed) tool field name. Only boolean
 * values are carried through.
 */
function emitBooleanPassthroughFields({
  def,
  hookType,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, boolean> {
  return Object.fromEntries(
    (converterConfig.booleanPassthroughFields ?? [])
      .filter(({ canonical, commandOnly }) => {
        if (commandOnly === true && hookType !== "command") return false;
        return typeof def[canonical] === "boolean";
      })
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
 * Emit the configured number passthrough fields on the tool side, mapping each
 * canonical field name to its (possibly renamed) tool field name. Only finite
 * numbers are carried through.
 */
function emitNumberPassthroughFields({
  def,
  hookType,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, number> {
  return Object.fromEntries(
    (converterConfig.numberPassthroughFields ?? [])
      .filter(({ canonical, commandOnly }) => {
        if (commandOnly === true && hookType !== "command") return false;
        return Number.isFinite(def[canonical]);
      })
      .map(({ canonical, tool }) => [tool, def[canonical] as number]),
  );
}

/**
 * Import the configured number passthrough fields back into canonical fields,
 * reversing {@link emitNumberPassthroughFields}. Only finite numbers are read.
 */
function importNumberPassthroughFields({
  h,
  converterConfig,
}: {
  h: Record<string, unknown>;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, number> {
  return Object.fromEntries(
    (converterConfig.numberPassthroughFields ?? [])
      .filter(({ tool }) => Number.isFinite(h[tool]))
      .map(({ canonical, tool }) => [canonical, h[tool] as number]),
  );
}

/**
 * Emit the configured string passthrough fields on the tool side, mapping each
 * canonical field name to its (possibly renamed) tool field name. Only non-empty
 * string values are carried through.
 */
function emitStringPassthroughFields({
  def,
  hookType,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, string> {
  return Object.fromEntries(
    (converterConfig.stringPassthroughFields ?? [])
      .filter(({ canonical, commandOnly }) => {
        if (commandOnly === true && hookType !== "command") return false;
        return typeof def[canonical] === "string" && def[canonical] !== "";
      })
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
 * Emit the configured string-array passthrough fields on the tool side.
 */
function emitArrayPassthroughFields({
  def,
  hookType,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, string[]> {
  return Object.fromEntries(
    (converterConfig.arrayPassthroughFields ?? [])
      .filter(({ canonical, commandOnly }) => {
        if (commandOnly === true && hookType !== "command") return false;
        return isStringArray(def[canonical]);
      })
      .map(({ canonical, tool }) => [tool, def[canonical] as string[]]),
  );
}

/**
 * Import the configured string-array passthrough fields, reversing
 * {@link emitArrayPassthroughFields}.
 */
function importArrayPassthroughFields({
  h,
  converterConfig,
  logger,
}: {
  h: Record<string, unknown>;
  converterConfig: ToolHooksConverterConfig;
  logger?: Logger;
}): Record<string, string[]> {
  const fields = converterConfig.arrayPassthroughFields ?? [];
  for (const { tool } of fields) {
    if (h[tool] !== undefined && !isSafeStringArray(h[tool])) {
      // The `hooks` key is owned in some tools' shared config, so a dropped
      // value disappears from the file on the next generate.
      logger?.warn(
        `Dropping "${tool}" while importing a hook: it must be a list of strings without ` +
          `newline, carriage return or NUL characters.`,
      );
    }
  }
  return Object.fromEntries(
    fields
      .filter(({ tool }) => isSafeStringArray(h[tool]))
      .map(({ canonical, tool }) => [canonical, h[tool] as string[]]),
  );
}

/**
 * Emit the configured string-map passthrough fields on the tool side. Only maps
 * whose values are all control-character-free strings are carried through.
 */
function emitRecordPassthroughFields({
  def,
  hookType,
  converterConfig,
}: {
  def: HooksConfig["hooks"][string][number];
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, Record<string, string>> {
  return Object.fromEntries(
    (converterConfig.recordPassthroughFields ?? [])
      .filter(({ canonical, commandOnly }) => {
        if (commandOnly === true && hookType !== "command") return false;
        return isSafeStringRecord(def[canonical]);
      })
      .map(({ canonical, tool }) => [tool, def[canonical] as Record<string, string>]),
  );
}

/**
 * Import the configured string-map passthrough fields, reversing
 * {@link emitRecordPassthroughFields}.
 */
function importRecordPassthroughFields({
  h,
  hookType,
  converterConfig,
  logger,
}: {
  h: Record<string, unknown>;
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
  logger?: Logger;
}): Record<string, Record<string, string>> {
  // `commandOnly` is honored on import as well as export, so an `env` found on
  // an http hook is not imported into a canonical field the exporter would then
  // drop — that asymmetry would silently delete the value on the next generate.
  const fields = (converterConfig.recordPassthroughFields ?? []).filter(
    ({ commandOnly }) => commandOnly !== true || hookType === "command",
  );
  for (const { tool } of fields) {
    if (h[tool] !== undefined && !isSafeStringRecord(h[tool])) {
      // The `hooks` key is owned in some tools' shared config, so a dropped
      // value disappears from the file on the next generate.
      logger?.warn(
        `Dropping "${tool}" while importing a hook: it must be a map of strings without ` +
          `newline, carriage return or NUL characters.`,
      );
    }
  }
  return Object.fromEntries(
    fields
      .filter(({ tool }) => isSafeStringRecord(h[tool]))
      .map(({ canonical, tool }) => [canonical, h[tool] as Record<string, string>]),
  );
}

/**
 * A group-level passthrough value: an object payload (e.g. AugmentCode's
 * `metadata`) or a scalar filter (e.g. Factory Droid's `commandRegex`).
 */
type GroupPassthroughValue = Record<string, unknown> | string;

/**
 * Check a value against the shape its field documents. A string field also
 * rejects control characters, matching the canonical `safeString` so an
 * imported value cannot fail validation on the next generate.
 */
function isGroupPassthroughValue(
  value: unknown,
  valueType: "object" | "string" = "object",
): value is GroupPassthroughValue {
  if (valueType === "string") {
    return typeof value === "string" && !CONTROL_CHARS.some((char) => value.includes(char));
  }
  return isPlainObject(value);
}

/**
 * Emit the configured group-level passthrough fields, taken from the first
 * definition of the group that carries one.
 */
function emitGroupPassthroughFields({
  defs,
  eventName,
  converterConfig,
  logger,
}: {
  defs: HooksConfig["hooks"][string];
  eventName: string;
  converterConfig: ToolHooksConverterConfig;
  logger?: Logger;
}): Record<string, GroupPassthroughValue> {
  const emitted: Record<string, GroupPassthroughValue> = {};
  for (const { canonical, tool, valueType } of converterConfig.groupPassthroughFields ?? []) {
    const carried = defs.map((def) => def[canonical]);
    const first = carried.find((value) => isGroupPassthroughValue(value, valueType));
    if (first === undefined) {
      continue;
    }
    // One value per group, so hooks sharing a matcher cannot each keep their
    // own — and a hook that asked for nothing still receives whatever the group
    // ends up with. Say so, rather than let the payload a script gets widen on
    // the strength of who else happens to share its matcher.
    const firstStable = stableJson(first);
    const agrees = (value: unknown): boolean =>
      isGroupPassthroughValue(value, valueType) && stableJson(value) === firstStable;
    if (!carried.every(agrees)) {
      logger?.warn(
        `"${tool}" belongs to the whole matcher group on "${eventName}" hooks, so every hook in ` +
          `this group gets ${JSON.stringify(first)} — including any that asked for something ` +
          `else, or for nothing.`,
      );
    }
    emitted[tool] = first;
  }
  return emitted;
}

/**
 * Import the configured group-level passthrough fields onto a definition,
 * reversing {@link emitGroupPassthroughFields}.
 */
function importGroupPassthroughFields({
  rawEntry,
  converterConfig,
}: {
  rawEntry: ToolMatcherEntry;
  converterConfig: ToolHooksConverterConfig;
}): Record<string, GroupPassthroughValue> {
  const entry = rawEntry as unknown as Record<string, unknown>;
  return Object.fromEntries(
    (converterConfig.groupPassthroughFields ?? [])
      .filter(({ tool, valueType }) => isGroupPassthroughValue(entry[tool], valueType))
      .map(({ canonical, tool }) => [canonical, entry[tool] as GroupPassthroughValue]),
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
function isSupportedHookType({
  type,
  converterConfig,
}: {
  type: HookType | undefined;
  converterConfig: ToolHooksConverterConfig;
}): boolean {
  return converterConfig.supportedHookTypes?.has(type ?? "command") ?? true;
}

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
    if (!isSupportedHookType({ type: hookType, converterConfig })) {
      continue;
    }
    const command = applyCommandPrefix({ def, converterConfig });
    hooks.push({
      // Spread the boolean, number and string passthrough fields first so the
      // explicitly-handled core fields below always win: a misconfigured `tool`
      // name (e.g. mapping onto "type"/"command") can never silently shadow them.
      ...emitBooleanPassthroughFields({ def, hookType, converterConfig }),
      ...emitNumberPassthroughFields({ def, hookType, converterConfig }),
      ...emitStringPassthroughFields({ def, hookType, converterConfig }),
      ...emitArrayPassthroughFields({ def, hookType, converterConfig }),
      ...emitRecordPassthroughFields({ def, hookType, converterConfig }),
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
    const byMatcher = groupDefinitionsByMatcher({ definitions, converterConfig });
    const entries: unknown[] = [];
    const isNoMatcherEvent = converterConfig.noMatcherEvents?.has(eventName) ?? false;
    for (const { matcher: matcherKey, defs } of byMatcher.values()) {
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
      const groupFields = emitGroupPassthroughFields({
        // Only the definitions that survived the hook-type filter: a hook this
        // tool cannot express must not decide a field for the ones it does.
        defs: defs.filter(({ type }) => isSupportedHookType({ type, converterConfig })),
        eventName,
        converterConfig,
        logger,
      });
      // Group fields first, so a tool-side name colliding with `matcher` or
      // `hooks` could never shadow them — the ordering each per-hook
      // passthrough field already uses.
      entries.push(
        includeMatcher ? { ...groupFields, matcher: matcherKey, hooks } : { ...groupFields, hooks },
      );
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
  // The exec form's braced placeholder, so a generated hook round-trips back to
  // the relative command it was authored as.
  const bracedPrefix = `${bracePlaceholder(converterConfig.projectDirVar)}/`;
  if (cmd.startsWith(bracedPrefix)) {
    return `./${cmd.slice(bracedPrefix.length)}`;
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

/** Compare object values without letting key order decide the answer. */
function stableJson(value: Record<string, unknown> | string): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b))),
  );
}

/**
 * Control characters cannot ride from an existing tool config into a canonical
 * field the schema guards with `safeString`, or the next generate fails
 * validation on a file this import itself wrote — and the hooks feature is
 * skipped wholesale when that read fails.
 */
function isSafeStringRecord(value: unknown): value is Record<string, string> {
  return (
    isPlainObject(value) &&
    Object.values(value).every(
      (entry) => typeof entry === "string" && !CONTROL_CHARS.some((char) => entry.includes(char)),
    )
  );
}

function isSafeStringArray(value: unknown): value is string[] {
  return (
    isStringArray(value) &&
    value.every((entry) => !CONTROL_CHARS.some((char) => entry.includes(char)))
  );
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
  logger,
}: {
  h: Record<string, unknown>;
  rawEntry: ToolMatcherEntry;
  converterConfig: ToolHooksConverterConfig;
  logger?: Logger;
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
    ...importNumberPassthroughFields({ h, converterConfig }),
    ...importStringPassthroughFields({ h, converterConfig }),
    ...importArrayPassthroughFields({ h, converterConfig, logger }),
    ...importRecordPassthroughFields({ h, hookType, converterConfig, logger }),
    ...importGroupPassthroughFields({ rawEntry, converterConfig }),
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
  logger,
}: {
  rawEntry: ToolMatcherEntry;
  converterConfig: ToolHooksConverterConfig;
  logger?: Logger;
}): HooksConfig["hooks"][string] {
  const hookDefs = rawEntry.hooks ?? [];
  return hookDefs.map((h) => toolHookToCanonical({ h, rawEntry, converterConfig, logger }));
}

/**
 * Assemble the canonical hooks config a tool importer writes to
 * `.rulesync/hooks.jsonc`.
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
  logger,
}: {
  hooks: unknown;
  converterConfig: ToolHooksConverterConfig;
  logger?: Logger;
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
      defs.push(...toolMatcherEntryToCanonical({ rawEntry, converterConfig, logger }));
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}
