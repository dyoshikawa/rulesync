import { join } from "node:path";

import { CRUSH_HOOKS_KEY } from "../../constants/crush-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import {
  CANONICAL_TO_CRUSH_EVENT_NAMES,
  CRUSH_HOOK_EVENTS,
  CRUSH_TO_CANONICAL_EVENT_NAMES,
  CRUSH_TOOL_EVENTS,
  type HookDefinition,
  type HooksConfig,
} from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  crushConfigImportContent,
  getCrushConfigSettablePaths,
  parseCrushConfig,
  resolveCrushConfigFile,
  warnCrushTwinLeftovers,
} from "../crush-config.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * One entry of a `hooks.<Event>` array in `crush.json`.
 * @see https://github.com/charmbracelet/crush/blob/v0.99.0/internal/hooks/config.go
 */
type CrushHookEntry = {
  name?: string;
  matcher?: string;
  command: string;
  timeout?: number;
};

const SUPPORTED_CRUSH_EVENTS: ReadonlySet<string> = new Set(CRUSH_HOOK_EVENTS);

/**
 * Crush matches an event key case-insensitively and ignores underscores
 * (`PreToolUse`, `pre_tool_use` and `PRE_TOOL_USE` all work), so an import
 * looks the canonical name up by that normalized spelling.
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/load.go
 */
const NORMALIZED_CRUSH_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CRUSH_TO_CANONICAL_EVENT_NAMES).map(([crushEvent, canonical]) => [
    normalizeCrushEventName(crushEvent),
    canonical,
  ]),
);

function normalizeCrushEventName(event: string): string {
  return event.replaceAll("_", "").toLowerCase();
}

/** Crush tool events, by normalized spelling, on which a `matcher` is valid. */
const NORMALIZED_CRUSH_TOOL_EVENTS: ReadonlySet<string> = new Set(
  CRUSH_TOOL_EVENTS.map((event) => normalizeCrushEventName(event)),
);

/**
 * Resolve a `crush.hooks` override key to the canonical event it names, or
 * null when it names no canonical event. The key may be spelled the canonical
 * way (`stop`) or in any spelling Crush accepts for the event (`TurnEnd`,
 * `turn_end`), so an override an earlier import filed under a Crush name still
 * lands on the same event as the shared hooks.
 */
function resolveOverrideCanonicalEvent(key: string): string | null {
  if (lookupOwn({ record: CANONICAL_TO_CRUSH_EVENT_NAMES, key }) !== undefined) {
    return key;
  }
  return (
    lookupOwn({
      record: NORMALIZED_CRUSH_TO_CANONICAL_EVENT_NAMES,
      key: normalizeCrushEventName(key),
    }) ?? null
  );
}

/**
 * Build the `hooks` block of `crush.json` from a canonical hooks config.
 * Crush keys a flat array of `{name, matcher, command, timeout}` entries by
 * event name; `matcher` is a regex tested against the (lower-case) Crush tool
 * name and `timeout` is in seconds. Only `type: "command"` canonical hooks are
 * emitted, since a Crush hook is a shell command. A shared canonical event
 * Crush does not fire is skipped (the HooksProcessor reports it).
 *
 * Every `crush.hooks` override key is resolved to its event first, whatever
 * spelling it uses: the override replaces the shared entries of that event
 * (as for every other tool's override), and override keys that name the same
 * event are concatenated in order, the way Crush itself merges them. A key
 * that names no canonical event — such as `PermissionResult`, or one an
 * import filed there — is written verbatim so it round-trips; keys of that
 * kind that Crush reads as the same event are concatenated under the first
 * spelling. A `matcher` is only written on a tool event: Crush rejects the
 * whole config when one appears anywhere else.
 */
function canonicalToCrushHooks({
  config,
  toolOverride,
  logger,
}: {
  config: HooksConfig;
  toolOverride: HooksConfig["hooks"] | undefined;
  logger?: Logger;
}): Record<string, CrushHookEntry[]> {
  // Output Crush event name -> definitions, in insertion order.
  const shared = new Map<string, HookDefinition[]>();
  for (const [event, defs] of Object.entries(config.hooks)) {
    const crushEvent = SUPPORTED_CRUSH_EVENTS.has(event)
      ? lookupOwn({ record: CANONICAL_TO_CRUSH_EVENT_NAMES, key: event })
      : undefined;
    if (crushEvent !== undefined) {
      shared.set(crushEvent, defs);
    }
  }

  const override = new Map<string, HookDefinition[]>();
  // Normalized spelling -> first spelling seen, for keys with no canonical event.
  const verbatimSpellings = new Map<string, string>();
  for (const [key, defs] of Object.entries(toolOverride ?? {})) {
    if (isPrototypePollutionKey(key) || !Array.isArray(defs)) {
      continue;
    }
    const canonical = resolveOverrideCanonicalEvent(key);
    let crushEvent: string;
    if (canonical !== null) {
      crushEvent = lookupOwn({ record: CANONICAL_TO_CRUSH_EVENT_NAMES, key: canonical }) ?? key;
    } else {
      const normalized = normalizeCrushEventName(key);
      crushEvent = verbatimSpellings.get(normalized) ?? key;
      verbatimSpellings.set(normalized, crushEvent);
    }
    override.set(crushEvent, [...(override.get(crushEvent) ?? []), ...defs]);
  }

  const effective = new Map<string, HookDefinition[]>(shared);
  for (const [crushEvent, defs] of override) {
    effective.set(crushEvent, defs);
  }

  const hooks: Record<string, CrushHookEntry[]> = {};
  for (const [crushEvent, defs] of effective) {
    const allowsMatcher = NORMALIZED_CRUSH_TOOL_EVENTS.has(normalizeCrushEventName(crushEvent));
    const entries: CrushHookEntry[] = [];
    for (const def of defs) {
      const entry = canonicalDefToCrushEntry({ def, event: crushEvent, allowsMatcher, logger });
      if (entry !== null) {
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      hooks[crushEvent] = entries;
    }
  }

  return hooks;
}

/** Convert one canonical hook definition to a Crush entry, or null to skip. */
function canonicalDefToCrushEntry({
  def,
  event,
  allowsMatcher,
  logger,
}: {
  def: HookDefinition;
  event: string;
  allowsMatcher: boolean;
  logger?: Logger;
}): CrushHookEntry | null {
  if ((def.type ?? "command") !== "command") {
    // The HooksProcessor already warns about unsupported hook types per target.
    return null;
  }
  if (typeof def.command !== "string" || def.command === "") {
    logger?.warn(
      `Crush hook ${quoteValueForWarning(def.name ?? "")} under "${event}" has no ` +
        `"command", which Crush would discard, so it was skipped.`,
    );
    return null;
  }
  const entry: CrushHookEntry = { command: def.command };
  if (typeof def.name === "string" && def.name !== "") {
    entry.name = def.name;
  }
  // An omitted matcher fires on every tool, and so does `*`; Crush reads
  // the matcher as a regex, where `*` alone would not compile.
  if (typeof def.matcher === "string" && def.matcher !== "" && def.matcher !== "*") {
    if (allowsMatcher) {
      entry.matcher = def.matcher;
    } else {
      // Crush fails to load the whole config on a matcher outside a tool
      // event ("matcher is only supported on tool events").
      logger?.warn(
        `matcher ${quoteValueForWarning(def.matcher)} on "${event}" hook will be ignored — ` +
          `Crush only accepts a matcher on tool events.`,
      );
    }
  }
  if (typeof def.timeout === "number") {
    // Crush's `timeout` is an integer number of seconds; a fractional
    // canonical value rounds up so the hook never gets less time.
    entry.timeout = Math.ceil(def.timeout);
  }
  return entry;
}

/** Convert one raw hook entry to a canonical definition, or null to skip. */
function crushEntryToCanonicalDef(raw: unknown): HookDefinition | null {
  if (!isRecord(raw) || typeof raw.command !== "string") {
    return null;
  }
  const def: HookDefinition = { type: "command", command: raw.command };
  if (typeof raw.name === "string" && raw.name !== "") {
    def.name = raw.name;
  }
  if (typeof raw.matcher === "string" && raw.matcher !== "") {
    def.matcher = raw.matcher;
  }
  if (typeof raw.timeout === "number") {
    def.timeout = raw.timeout;
  }
  return def;
}

/**
 * Reverse {@link canonicalToCrushHooks}: parse the `hooks` block back into a
 * canonical event → definition[] record. An event Crush does not document is
 * carried under its own name so `buildImportedHooksConfig` files it under the
 * `crush.hooks` override.
 */
function crushHooksToCanonical(hooksBlock: unknown): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  if (!isRecord(hooksBlock)) {
    return canonical;
  }
  for (const [crushEvent, rawEntries] of Object.entries(hooksBlock)) {
    // The lookup below is own-property-only, so a crafted event such as
    // "toString" falls back to the raw name; a prototype-pollution key would
    // still be written as a key of the canonical record, so it is skipped.
    if (isPrototypePollutionKey(crushEvent) || !Array.isArray(rawEntries)) {
      continue;
    }
    const canonicalEvent =
      lookupOwn({
        record: NORMALIZED_CRUSH_TO_CANONICAL_EVENT_NAMES,
        key: normalizeCrushEventName(crushEvent),
      }) ?? crushEvent;
    const defs = rawEntries
      .map((raw) => crushEntryToCanonicalDef(raw))
      .filter((def): def is HookDefinition => def !== null);
    if (defs.length === 0) {
      continue;
    }
    const list = lookupOwn({ record: canonical, key: canonicalEvent }) ?? [];
    canonical[canonicalEvent] = [...list, ...defs];
  }
  return canonical;
}

/**
 * Crush hooks.
 *
 * Crush reads hooks from the `hooks` key of its JSON config —
 * `<project>/crush.json` (or an existing `.crush.json`; Crush merges the pair,
 * lists concatenated) at project scope and `~/.config/crush/crush.json` at
 * user scope — as
 * `hooks.<Event>: [{name?, matcher?, command, timeout?}]`. `matcher` is only
 * valid on tool events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
 * `PermissionRequest`, `PermissionResult`). The `hooks` key is owned outright; every other top-level key
 * of the file is preserved and the file is never deleted.
 *
 * @see https://github.com/charmbracelet/crush/blob/v0.99.0/docs/hooks/README.md
 * @see https://github.com/charmbracelet/crush/blob/v0.99.0/internal/config/hooks.go
 */
export class CrushHooks extends ToolHooks {
  private readonly json: Record<string, unknown>;

  constructor(params: AiFileParams) {
    super(params);
    this.json = parseCrushConfig(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // crush.json is Crush's primary config file, so it must never be removed
    // wholesale; clearing hooks happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    return getCrushConfigSettablePaths({ global });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CrushHooks> {
    const location = await resolveCrushConfigFile({ outputRoot, global });

    return new CrushHooks({
      outputRoot,
      relativeDirPath: location.relativeDirPath,
      relativeFilePath: location.relativeFilePath,
      fileContent: crushConfigImportContent(location),
      validate,
      global,
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
  }): Promise<CrushHooks> {
    const location = await resolveCrushConfigFile({ outputRoot, global });
    const existingContent = location.fileContent ?? "";
    warnCrushTwinLeftovers({ location, ownedPaths: [[CRUSH_HOOKS_KEY]], logger });

    const config = rulesyncHooks.getJson();
    const hooks = canonicalToCrushHooks({
      config,
      toolOverride: config.crush?.hooks,
      logger,
    });

    return new CrushHooks({
      outputRoot,
      relativeDirPath: location.relativeDirPath,
      relativeFilePath: location.relativeFilePath,
      // Keyed by the base settable paths: a resolved `.crush.json` twin shares
      // the `crush.json` ownership declaration.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(this.getSettablePaths({ global })),
        feature: "hooks",
        existingContent,
        patch: { [CRUSH_HOOKS_KEY]: hooks },
        filePath: location.filePath,
        logger,
      }),
      validate,
      global,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    const hooks = crushHooksToCanonical(this.json[CRUSH_HOOKS_KEY]);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "crush" }),
        null,
        2,
      ),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolHooksForDeletionParams): CrushHooks {
    // The shared config file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new CrushHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ [CRUSH_HOOKS_KEY]: {} }, null, 2),
      validate: false,
      global,
    });
  }
}
