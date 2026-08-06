import { posix, win32 } from "node:path";

import { z } from "zod/mini";

import {
  CONTROL_CHARS,
  type HookEvent,
  HookDefinitionSchema,
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
   * objects whose values are all strings are emitted and imported, and both
   * directions refuse a key that is empty or holds `=`, and a key or value
   * carrying a newline, carriage return or NUL: these maps become process
   * environment variables, where such a character is a variable-spoofing shape
   * rather than data.
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
  /**
   * When true, the canonical catch-all matcher `"*"` is exported as *no*
   * matcher instead of verbatim. Set it for a tool that compiles `matcher` as a
   * regular expression (where `"*"` is a syntax error) and treats an absent
   * matcher as match-all — emitting `"*"` there produces a rule the tool
   * refuses to compile and drops. Tools that generate code from the matcher
   * rewrite `"*"` to `".*"` in their own generators instead.
   */
  wildcardMatcherMeansAll?: boolean;
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
    const rawMatcher = def.matcher ?? "";
    // Normalized here rather than at emission so a `"*"` group and an
    // already-matcher-less group collapse into one entry instead of producing
    // two indistinguishable entries for the same event.
    const matcher = converterConfig.wildcardMatcherMeansAll && rawMatcher === "*" ? "" : rawMatcher;
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
 * The shape every per-hook passthrough registration shares. The five kinds
 * differ only in which canonical field names they accept and in the predicate
 * that decides whether a value is expressible, so both directions are
 * implemented once and parameterized by that predicate.
 */
type PassthroughFieldSpec = {
  readonly canonical: string;
  readonly tool: string;
  readonly commandOnly?: boolean;
};

/**
 * Whether a field registered for `command` hooks only applies to this hook.
 * Applied on both export and import: a value imported into a canonical field
 * the exporter would then drop is silently deleted on the next generate.
 */
function isFieldApplicable({
  commandOnly,
  hookType,
}: {
  commandOnly: boolean | undefined;
  hookType: HookType;
}): boolean {
  return commandOnly !== true || hookType === "command";
}

/**
 * Decides whether a value can be carried through for the field it is
 * registered on. It receives the canonical field name too, so a kind can layer
 * a per-field rule (e.g. the canonical schema's own constraints) on top of the
 * shape check every field of that kind shares.
 */
type PassthroughValidator = (args: { value: unknown; canonical: string }) => boolean;

/**
 * Emit the configured passthrough fields on the tool side, mapping each
 * canonical field name to its (possibly renamed) tool field name. Only values
 * accepted by `isValid` are carried through, so a malformed field can't leak
 * into a config the tool would reject.
 *
 * A field the tool documents on `command` hooks only is dropped when authored
 * on another hook type. That is a value the user hand-wrote in
 * `.rulesync/hooks.*` and the canonical schema does not cross-validate it
 * against the hook's type, so it is warned about rather than deleted in
 * silence — the mirror of the import side.
 */
function emitPassthroughFields<TValue>({
  def,
  hookType,
  eventName,
  fields,
  isValid,
  warn,
}: {
  def: HooksConfig["hooks"][string][number];
  hookType: HookType;
  eventName: string;
  fields: readonly PassthroughFieldSpec[];
  isValid: PassthroughValidator;
  warn?: (message: string) => void;
}): Record<string, TValue> {
  for (const { canonical, tool, commandOnly } of fields) {
    const value = def[canonical];
    if (value === undefined) {
      continue;
    }
    if (!isFieldApplicable({ commandOnly, hookType })) {
      warn?.(
        `Dropping "${canonical}" from a "${hookType}" hook on "${eventName}": this tool documents ` +
          `"${tool}" on "command" hooks only, so it is not generated.`,
      );
      continue;
    }
    if (!isValid({ value, canonical })) {
      // The canonical schema is looser than some tool fields (it lets an `env`
      // key hold `=`, which a tool would rebuild into a different variable),
      // so an authored value can be valid and still unusable here.
      warn?.(
        `Dropping "${canonical}" from a "${hookType}" hook on "${eventName}": ` +
          `${JSON.stringify(value)} is not a value this tool can express as "${tool}".`,
      );
    }
  }
  return Object.fromEntries(
    fields
      .filter(
        ({ canonical, commandOnly }) =>
          isFieldApplicable({ commandOnly, hookType }) &&
          isValid({ value: def[canonical], canonical }),
      )
      .map(({ canonical, tool }) => [tool, def[canonical] as TValue]),
  );
}

/**
 * Import the configured passthrough fields back into canonical fields,
 * reversing {@link emitPassthroughFields}. A field the tool documents on
 * `command` hooks only is skipped here too, and `describeInvalid` — when the
 * kind has a rule an authored file can plausibly violate — turns a rejected
 * value into a warning instead of a silent drop.
 */
function importPassthroughFields<TValue>({
  h,
  hookType,
  fields,
  isValid,
  describeInvalid,
  warn,
}: {
  h: Record<string, unknown>;
  hookType: HookType;
  fields: readonly PassthroughFieldSpec[];
  isValid: PassthroughValidator;
  describeInvalid?: (args: { tool: string; canonical: string; value: unknown }) => string;
  warn?: (message: string) => void;
}): Record<string, TValue> {
  const applicable = fields.filter(({ commandOnly }) =>
    isFieldApplicable({ commandOnly, hookType }),
  );
  const skipped = fields.filter(({ commandOnly }) => !isFieldApplicable({ commandOnly, hookType }));
  // Warned rather than dropped silently, for the callers that thread a logger
  // through: neither an inapplicable nor an unusable value survives the import,
  // so it is gone from the canonical config the next generate reads.
  for (const { tool } of skipped) {
    if (h[tool] !== undefined) {
      warn?.(
        `Dropping "${tool}" from an imported "${hookType}" hook: this tool documents it on ` +
          `"command" hooks only, so it is not imported.`,
      );
    }
  }
  for (const { tool, canonical } of applicable) {
    if (
      describeInvalid !== undefined &&
      h[tool] !== undefined &&
      !isValid({ value: h[tool], canonical })
    ) {
      warn?.(describeInvalid({ tool, canonical, value: h[tool] }));
    }
  }
  return Object.fromEntries(
    applicable
      .filter(({ tool, canonical }) => isValid({ value: h[tool], canonical }))
      .map(({ canonical, tool }) => [canonical, h[tool] as TValue]),
  );
}

const isBooleanValue: PassthroughValidator = ({ value }) => typeof value === "boolean";
const isFiniteNumber: PassthroughValidator = ({ value }) => Number.isFinite(value);
const isNonEmptyString = (value: unknown): boolean => typeof value === "string" && value !== "";
const isEmittableString: PassthroughValidator = ({ value }) => isNonEmptyString(value);
const isEmittableArray: PassthroughValidator = ({ value }) => isStringArray(value);
const isEmittableRecord: PassthroughValidator = ({ value }) => isSafeStringRecord(value);
const isImportableArray: PassthroughValidator = ({ value }) => isSafeStringArray(value);

/**
 * The canonical schema of one hook field, looked up by name. Read off the
 * schema's own shape rather than by parsing a one-field object, so a `canonical`
 * name that no longer exists resolves to `undefined` (a `looseObject` would
 * accept an unknown key and silently validate nothing) and a typo is caught by
 * the tests instead of quietly disabling the check.
 */
const CANONICAL_FIELD_SCHEMAS: Partial<Record<string, z.ZodMiniType>> =
  HookDefinitionSchema.def.shape;

/**
 * Whether a value satisfies the constraints the canonical schema puts on the
 * field it would be imported into.
 *
 * Import needs this on top of the kind's shape check: a hand-written tool
 * settings file can hold `"shell": "zsh"`, which is a non-empty string but not
 * a member of the canonical `z.enum(["bash", "powershell"])`. Letting it in
 * would write a `.rulesync/hooks.jsonc` that fails validation on the *next*
 * run, taking the whole hooks feature down with it.
 */
function satisfiesCanonicalField({
  value,
  canonical,
}: {
  value: unknown;
  canonical: string;
}): boolean {
  const schema = canonicalFieldSchema(canonical);
  return schema !== undefined && z.safeParse(schema, value).success;
}

/** Own properties only, so a name like `toString` resolves to nothing. */
function canonicalFieldSchema(canonical: string): z.ZodMiniType | undefined {
  return Object.hasOwn(CANONICAL_FIELD_SCHEMAS, canonical)
    ? CANONICAL_FIELD_SCHEMAS[canonical]
    : undefined;
}

const isImportableString: PassthroughValidator = ({ value, canonical }) =>
  isNonEmptyString(value) && satisfiesCanonicalField({ value, canonical });

const isImportableNumber: PassthroughValidator = ({ value, canonical }) =>
  Number.isFinite(value) && satisfiesCanonicalField({ value, canonical });

/**
 * Say which rule the value broke, so the warning names the actual constraint
 * rather than asserting a canonical rejection that may not be the reason. A
 * closed enum lists its members; a rule carrying its own message (the
 * control-character check behind `safeString`) reuses it.
 */
function describeScalarConstraint({
  canonical,
  value,
}: {
  canonical: string;
  value: unknown;
}): string {
  const schema = canonicalFieldSchema(canonical);
  const result = schema === undefined ? undefined : z.safeParse(schema, value);
  if (result === undefined || result.success) {
    // Rejected by the kind's own rule instead: a string field is not carried
    // through empty, since the emit side would drop it again on the next run.
    return `it is not a value this field carries through.`;
  }
  const issue = result.error.issues[0];
  if (issue === undefined) {
    return `it is not a value the canonical "${canonical}" field accepts.`;
  }
  return `it does not satisfy the canonical "${canonical}" field: ${issue.message}.`;
}

const describeInvalidScalar = ({
  tool,
  canonical,
  value,
}: {
  tool: string;
  canonical: string;
  value: unknown;
}): string =>
  `Dropping "${tool}" (${JSON.stringify(value)}) while importing a hook: ` +
  `${describeScalarConstraint({ canonical, value })} Importing it would fail validation on the ` +
  `next run.`;

const describeInvalidArray = ({ tool }: { tool: string }): string =>
  `Dropping "${tool}" while importing a hook: it must be a list of strings without ` +
  `newline, carriage return or NUL characters.`;

const describeInvalidRecord = ({ tool }: { tool: string }): string =>
  `Dropping "${tool}" while importing a hook: it must be a map of strings whose keys ` +
  `are non-empty and free of "=", and whose keys and values carry no newline, ` +
  `carriage return or NUL characters.`;

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

/**
 * Emit every per-hook passthrough kind for one canonical definition.
 */
function emitAllPassthroughFields({
  def,
  hookType,
  eventName,
  converterConfig,
  warn,
}: {
  def: HooksConfig["hooks"][string][number];
  hookType: HookType;
  eventName: string;
  converterConfig: ToolHooksConverterConfig;
  warn?: (message: string) => void;
}): Record<string, unknown> {
  return {
    ...emitPassthroughFields<boolean>({
      def,
      hookType,
      eventName,
      fields: converterConfig.booleanPassthroughFields ?? [],
      isValid: isBooleanValue,
      warn,
    }),
    ...emitPassthroughFields<number>({
      def,
      hookType,
      eventName,
      fields: converterConfig.numberPassthroughFields ?? [],
      isValid: isFiniteNumber,
      warn,
    }),
    ...emitPassthroughFields<string>({
      def,
      hookType,
      eventName,
      fields: converterConfig.stringPassthroughFields ?? [],
      isValid: isEmittableString,
      warn,
    }),
    ...emitPassthroughFields<string[]>({
      def,
      hookType,
      eventName,
      fields: converterConfig.arrayPassthroughFields ?? [],
      isValid: isEmittableArray,
      warn,
    }),
    ...emitPassthroughFields<Record<string, string>>({
      def,
      hookType,
      eventName,
      fields: converterConfig.recordPassthroughFields ?? [],
      isValid: isEmittableRecord,
      warn,
    }),
  };
}

function buildToolHooks({
  defs,
  eventName,
  converterConfig,
  warn,
}: {
  defs: HooksConfig["hooks"][string];
  eventName: string;
  converterConfig: ToolHooksConverterConfig;
  warn?: (message: string) => void;
}): Array<Record<string, unknown>> {
  const hooks: Array<Record<string, unknown>> = [];
  for (const def of defs) {
    const hookType = def.type ?? "command";
    if (!isSupportedHookType({ type: hookType, converterConfig })) {
      continue;
    }
    const command = applyCommandPrefix({ def, converterConfig });
    hooks.push({
      // Spread every passthrough field first so the explicitly-handled core
      // fields below always win: a misconfigured `tool` name (e.g. mapping onto
      // "type"/"command") can never silently shadow them.
      ...emitAllPassthroughFields({ def, hookType, eventName, converterConfig, warn }),
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
 * A `warn` that says each distinct thing once per conversion.
 */
function warnOnce(logger: Logger | undefined): (message: string) => void {
  const seen = new Set<string>();
  return (message) => {
    if (seen.has(message)) {
      return;
    }
    seen.add(message);
    logger?.warn(message);
  };
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
  // A field authored in the wrong place is usually authored once and matched by
  // several hooks of the same event, so the same sentence would otherwise be
  // repeated per hook. It names the canonical field, the hook type and the
  // event, so one line already says everything the user needs.
  const warn = warnOnce(logger);
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
      const hooks = buildToolHooks({ defs, eventName, converterConfig, warn });
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
 * A string map safe to hand a tool as a hook's environment block. On top of
 * {@link isStringRecord} it rejects a non-plain object (a class instance is not
 * data) and applies the control-character rule to the values, as
 * {@link isSafeStringArray} does for `args`.
 *
 * The keys are checked more strictly than the values. A tool builds each entry
 * back into a `KEY=VALUE` string for the spawned process, so a key holding `=`
 * (or a control character, or nothing at all) names a different variable than
 * it appears to — `PATH=/tmp/evil` written as a key would set `PATH`. An
 * authored `.rulesync/hooks.*` can arrive via `rulesync fetch`, so that is not
 * a shape to pass along.
 */
function isSafeStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value) || !isStringRecord(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, entry]) =>
      key !== "" &&
      !key.includes("=") &&
      !CONTROL_CHARS.some((char) => key.includes(char) || entry.includes(char)),
  );
}

/**
 * Control characters cannot ride from an existing tool config into a canonical
 * field the schema guards with `safeString`, or the next generate fails
 * validation on a file this import itself wrote — and the hooks feature is
 * skipped wholesale when that read fails.
 */
function isSafeStringArray(value: unknown): value is string[] {
  return (
    isStringArray(value) &&
    value.every((entry) => !CONTROL_CHARS.some((char) => entry.includes(char)))
  );
}

/**
 * A raw string kept only if the canonical field it would land in accepts it,
 * warning when it does not. The canonical string fields are guarded by
 * `safeString`, so an existing tool config carrying a control character would
 * otherwise be imported into a file the next generate refuses to read.
 */
function importCanonicalString({
  value,
  canonical,
  warn,
}: {
  value: unknown;
  canonical: string;
  warn?: (message: string) => void;
}): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (satisfiesCanonicalField({ value, canonical })) {
    return value;
  }
  warn?.(describeInvalidScalar({ tool: canonical, canonical, value }));
  return undefined;
}

/**
 * Import the payload fields specific to a hook type, type-checking each raw
 * value before it enters the canonical definition.
 */
function importTypePayloadFields({
  h,
  hookType,
  warn,
}: {
  h: Record<string, unknown>;
  hookType: HookType;
  warn?: (message: string) => void;
}): Partial<HooksConfig["hooks"][string][number]> {
  if (hookType === "http") {
    const url = importCanonicalString({ value: h.url, canonical: "url", warn });
    // The canonical check covers the header values too: they carry
    // `safeString`, which the shape check alone does not enforce — and a
    // newline in a header value is the header-splitting shape.
    const headers =
      isStringRecord(h.headers) &&
      !satisfiesCanonicalField({ value: h.headers, canonical: "headers" })
        ? (warn?.(
            describeInvalidScalar({ tool: "headers", canonical: "headers", value: h.headers }),
          ),
          undefined)
        : h.headers;
    return {
      ...(url !== undefined && { url }),
      ...(isStringRecord(headers) && { headers }),
      ...(isStringArray(h.allowedEnvVars) && { allowedEnvVars: h.allowedEnvVars }),
    };
  }
  if (hookType === "mcp_tool") {
    const server = importCanonicalString({ value: h.server, canonical: "server", warn });
    const tool = importCanonicalString({ value: h.tool, canonical: "tool", warn });
    return {
      ...(server !== undefined && { server }),
      ...(tool !== undefined && { tool }),
      ...(h.input !== null &&
        typeof h.input === "object" &&
        !Array.isArray(h.input) && { input: h.input as Record<string, unknown> }),
    };
  }
  if (hookType === "prompt" || hookType === "agent") {
    const model = importCanonicalString({ value: h.model, canonical: "model", warn });
    return model !== undefined ? { model } : {};
  }
  return {};
}

/**
 * Import every per-hook passthrough kind for one tool hook record, reversing
 * the emit side in {@link buildToolHooks}.
 */
function importAllPassthroughFields({
  h,
  hookType,
  converterConfig,
  warn,
}: {
  h: Record<string, unknown>;
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
  warn?: (message: string) => void;
}): Record<string, unknown> {
  return {
    ...importPassthroughFields<boolean>({
      h,
      hookType,
      fields: converterConfig.booleanPassthroughFields ?? [],
      isValid: isBooleanValue,
      warn,
    }),
    ...importPassthroughFields<number>({
      h,
      hookType,
      fields: converterConfig.numberPassthroughFields ?? [],
      // Stricter than the emit side: a value the canonical schema narrows
      // further (an integer, a non-negative one) must not be imported only to
      // fail validation on the next run.
      isValid: isImportableNumber,
      describeInvalid: describeInvalidScalar,
      warn,
    }),
    ...importPassthroughFields<string>({
      h,
      hookType,
      fields: converterConfig.stringPassthroughFields ?? [],
      // Stricter than the emit side: a hand-written settings file can hold a
      // string the canonical field rejects (an off-enum `shell`, a control
      // character in a `safeString` field).
      isValid: isImportableString,
      describeInvalid: describeInvalidScalar,
      warn,
    }),
    ...importPassthroughFields<string[]>({
      h,
      hookType,
      fields: converterConfig.arrayPassthroughFields ?? [],
      // Stricter than the emit side: control characters cannot ride from an
      // existing tool config into a canonical field guarded by `safeString`.
      isValid: isImportableArray,
      describeInvalid: describeInvalidArray,
      warn,
    }),
    ...importPassthroughFields<Record<string, string>>({
      h,
      hookType,
      fields: converterConfig.recordPassthroughFields ?? [],
      isValid: isEmittableRecord,
      describeInvalid: describeInvalidRecord,
      warn,
    }),
  };
}

/**
 * Convert a single tool hook record into a canonical hook definition.
 */
function toolHookToCanonical({
  h,
  rawEntry,
  converterConfig,
  warn,
}: {
  h: Record<string, unknown>;
  rawEntry: ToolMatcherEntry;
  converterConfig: ToolHooksConverterConfig;
  warn?: (message: string) => void;
}): HooksConfig["hooks"][string][number] {
  const hookType = isImportedHookType(h.type) ? h.type : "command";
  // A value that defines this hook type has already been checked by
  // `describeHookSkipReason`; this catches the same field left on a type it
  // does not define, where losing it alone changes nothing.
  const command = importCanonicalString({
    value: stripCommandPrefix({ command: h.command, converterConfig }),
    canonical: "command",
    warn,
  });
  const timeout = typeof h.timeout === "number" ? h.timeout : undefined;
  const prompt = importCanonicalString({ value: h.prompt, canonical: "prompt", warn });
  const name = importCanonicalString({ value: h.name, canonical: "name", warn });
  const description = importCanonicalString({
    value: h.description,
    canonical: "description",
    warn,
  });
  const matcher = rawEntry.matcher;
  return {
    type: hookType,
    ...(command !== undefined && command !== null && { command }),
    ...(timeout !== undefined && timeout !== null && { timeout }),
    ...(prompt !== undefined && prompt !== null && { prompt }),
    // Type-specific payload fields, preserved so http/mcp_tool/agent hooks
    // found in an existing settings file round-trip instead of silently
    // degrading to broken command hooks.
    ...importTypePayloadFields({ h, hookType, warn }),
    ...(converterConfig.passthroughFields?.includes("name") && name !== undefined && { name }),
    ...(converterConfig.passthroughFields?.includes("description") &&
      description !== undefined && { description }),
    ...importAllPassthroughFields({ h, hookType, converterConfig, warn }),
    ...importGroupPassthroughFields({ rawEntry, converterConfig }),
    ...(matcher !== undefined && matcher !== null && matcher !== "" && { matcher }),
  };
}

/**
 * The fields whose value decides what a hook *is*, listed per hook type. When
 * one of them cannot be imported, dropping just the field would leave
 * something worse than nothing: a hook that loses its body runs nothing, and
 * one that loses its `matcher` fires on *everything* — a silent widening of
 * what the imported rule does. So the whole definition is skipped instead,
 * with the reason named. A field that does not define *this* type (a `prompt`
 * left on a command hook) is not one of them: it is dropped on its own, the
 * way any other unusable field is.
 */
function definingFields({
  h,
  rawEntry,
  hookType,
  converterConfig,
}: {
  h: Record<string, unknown>;
  rawEntry: ToolMatcherEntry;
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
}): Array<{ field: string; value: unknown }> {
  const fields: Array<{ field: string; value: unknown }> = [
    // The matcher restricts every hook of the group, whatever their types.
    { field: "matcher", value: rawEntry.matcher },
  ];
  if (hookType === "command") {
    fields.push({
      // Only a string carries a prefix to strip, and that is the form the
      // canonical file would hold. Anything else is reported as authored, so a
      // `command` that is a number or a list is caught rather than read as
      // "no command".
      field: "command",
      value:
        typeof h.command === "string"
          ? stripCommandPrefix({ command: h.command, converterConfig })
          : h.command,
    });
  }
  if (hookType === "prompt" || hookType === "agent") {
    fields.push({ field: "prompt", value: h.prompt });
  }
  if (hookType === "http") {
    fields.push({ field: "url", value: h.url });
  }
  if (hookType === "mcp_tool") {
    fields.push({ field: "server", value: h.server }, { field: "tool", value: h.tool });
  }
  return fields;
}

/**
 * Why no hook of this matcher group can be imported, or `undefined` when they
 * can. A group field that *restricts* when its hooks run (`subdividesGroup`)
 * is the group-level twin of `matcher`: importing the group without it would
 * widen every hook in it, so the group is skipped instead.
 */
function describeGroupSkipReason({
  rawEntry,
  converterConfig,
}: {
  rawEntry: ToolMatcherEntry;
  converterConfig: ToolHooksConverterConfig;
}): string | undefined {
  const entry = rawEntry as unknown as Record<string, unknown>;
  for (const { tool, valueType, subdividesGroup } of converterConfig.groupPassthroughFields ?? []) {
    const value = entry[tool];
    if (subdividesGroup !== true || value === undefined) {
      continue;
    }
    if (!isGroupPassthroughValue(value, valueType)) {
      return (
        `Skipping the hooks of a matcher group while importing: its "${tool}" ` +
        `(${JSON.stringify(value)}) is unusable, and these hooks run only where it matches. ` +
        `Importing them without it would widen when they fire, so they are skipped.`
      );
    }
  }
  return undefined;
}

/**
 * Why this hook cannot be imported, or `undefined` when it can.
 */
function describeHookSkipReason({
  h,
  rawEntry,
  hookType,
  converterConfig,
}: {
  h: Record<string, unknown>;
  rawEntry: ToolMatcherEntry;
  hookType: HookType;
  converterConfig: ToolHooksConverterConfig;
}): string | undefined {
  for (const { field, value } of definingFields({ h, rawEntry, hookType, converterConfig })) {
    if (value === undefined || satisfiesCanonicalField({ value, canonical: field })) {
      continue;
    }
    return (
      `Skipping a hook while importing: its "${field}" (${JSON.stringify(value)}) is unusable — ` +
      `${describeScalarConstraint({ canonical: field, value })} Keeping the hook without it would ` +
      `change what it does, so the whole hook is skipped.`
    );
  }
  return undefined;
}

/**
 * Convert a single tool matcher entry into canonical hook definitions.
 */
function toolMatcherEntryToCanonical({
  rawEntry,
  converterConfig,
  warn,
}: {
  rawEntry: ToolMatcherEntry;
  converterConfig: ToolHooksConverterConfig;
  warn?: (message: string) => void;
}): HooksConfig["hooks"][string] {
  const hookDefs = rawEntry.hooks ?? [];
  const groupSkipReason = describeGroupSkipReason({ rawEntry, converterConfig });
  if (groupSkipReason !== undefined) {
    warn?.(groupSkipReason);
    return [];
  }
  const definitions: HooksConfig["hooks"][string] = [];
  for (const h of hookDefs) {
    const hookType = isImportedHookType(h.type) ? h.type : "command";
    const skipReason = describeHookSkipReason({ h, rawEntry, hookType, converterConfig });
    if (skipReason !== undefined) {
      warn?.(skipReason);
      continue;
    }
    definitions.push(toolHookToCanonical({ h, rawEntry, converterConfig, warn }));
  }
  return definitions;
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
  // One sentence per distinct problem, however many hooks repeat it: a matcher
  // belongs to a whole group, so its message would otherwise be printed once
  // per hook in that group.
  const warn = warnOnce(logger);
  const canonical: HooksConfig["hooks"] = {};
  for (const [toolEventName, matcherEntries] of Object.entries(hooks)) {
    const eventName = converterConfig.toolToCanonicalEventNames[toolEventName] ?? toolEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of matcherEntries) {
      if (!isToolMatcherEntry(rawEntry)) continue;
      defs.push(...toolMatcherEntryToCanonical({ rawEntry, converterConfig, warn }));
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}
