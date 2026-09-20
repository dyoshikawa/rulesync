import { join } from "node:path";

import {
  POOL_DIR,
  POOL_GLOBAL_DIR,
  POOL_HOOKS_KEY,
  POOL_SETTINGS_FILE_NAME,
} from "../../constants/pool-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_POOL_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
  POOL_HOOK_EVENTS,
  POOL_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
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
 * One entry of a `hooks.<Event>` list in Pool's settings file. `matcher` is
 * required by Pool's schema on every event and tested against the tool name
 * on `PreToolUse`/`PostToolUse` only; `timeout` is an integer number of
 * seconds (Pool defaults to 60).
 * @see https://docs.poolside.ai/settings-file-reference
 */
type PoolHookEntry = {
  name?: string;
  matcher: string;
  command: string;
  timeout?: number;
};

/** The matcher Pool reads as "any tool"; `""` means the same. */
const POOL_MATCH_ALL = "*";

const SUPPORTED_POOL_EVENTS: ReadonlySet<string> = new Set(POOL_HOOK_EVENTS);

/**
 * The Pool events that test `matcher` against a tool name. Pool ignores the
 * field on every other event (it stays required by the schema), so an
 * authored matcher there is dropped with a warning and `*` written instead.
 */
const POOL_MATCHER_EVENTS: ReadonlySet<string> = new Set(["PreToolUse", "PostToolUse"]);

/**
 * Single spelling of the settings.yaml codec/policy, matching PoolMcp and
 * PoolPermissions: fail closed on an unparseable root rather than replacing
 * the user's primary Pool settings with generated output.
 */
function parsePoolSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "yaml",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * Build the `hooks` event lists of Pool's settings file from a canonical hooks
 * config. Pool keys a flat list of `{name, matcher, command, timeout}` entries
 * by event name. Only `type: "command"` canonical hooks are emitted, since a
 * Pool hook is a shell command. A shared canonical event Pool does not fire is
 * skipped (the HooksProcessor reports it), while an event under the
 * `pool.hooks` override — such as one an import filed there — is written
 * verbatim so it round-trips.
 */
function canonicalToPoolHooks({
  config,
  toolOverride,
  logger,
}: {
  config: HooksConfig;
  toolOverride: HooksConfig["hooks"] | undefined;
  logger?: Logger;
}): Record<string, PoolHookEntry[]> {
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (SUPPORTED_POOL_EVENTS.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effective: HooksConfig["hooks"] = { ...sharedHooks, ...toolOverride };

  const hooks: Record<string, PoolHookEntry[]> = {};
  for (const [event, defs] of Object.entries(effective)) {
    if (isPrototypePollutionKey(event)) {
      continue;
    }
    const poolEvent = lookupOwn({ record: CANONICAL_TO_POOL_EVENT_NAMES, key: event }) ?? event;
    const entries: PoolHookEntry[] = [];
    for (const def of defs) {
      const entry = canonicalDefToPoolEntry({ def, event, poolEvent, logger });
      if (entry !== null) {
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      hooks[poolEvent] = entries;
    }
  }

  return hooks;
}

/** Convert one canonical hook definition to a Pool entry, or null to skip. */
function canonicalDefToPoolEntry({
  def,
  event,
  poolEvent,
  logger,
}: {
  def: HookDefinition;
  event: string;
  poolEvent: string;
  logger?: Logger;
}): PoolHookEntry | null {
  if ((def.type ?? "command") !== "command") {
    // The HooksProcessor already warns about unsupported hook types per target.
    return null;
  }
  if (typeof def.command !== "string" || def.command === "") {
    logger?.warn(
      `Pool hook ${quoteValueForWarning(def.name ?? "")} under "${event}" has no ` +
        `"command", which Pool would reject, so it was skipped.`,
    );
    return null;
  }
  const authoredMatcher =
    typeof def.matcher === "string" && def.matcher !== "" ? def.matcher : POOL_MATCH_ALL;
  let matcher = authoredMatcher;
  if (!POOL_MATCHER_EVENTS.has(poolEvent) && authoredMatcher !== POOL_MATCH_ALL) {
    logger?.warn(
      `Pool ignores "matcher" on "${poolEvent}", so the matcher ` +
        `${quoteValueForWarning(authoredMatcher)} of the hook ` +
        `${quoteValueForWarning(def.name ?? def.command)} under "${event}" was dropped.`,
    );
    matcher = POOL_MATCH_ALL;
  }
  // `name` first, the way Pool's docs spell an entry.
  const entry: PoolHookEntry = {
    ...(typeof def.name === "string" && def.name !== "" ? { name: def.name } : {}),
    matcher,
    command: def.command,
  };
  if (typeof def.timeout === "number") {
    // Pool's `timeout` is an integer number of seconds; a fractional canonical
    // value rounds up so the hook never gets less time.
    entry.timeout = Math.ceil(def.timeout);
  }
  return entry;
}

/** Convert one raw hook entry to a canonical definition, or null to skip. */
function poolEntryToCanonicalDef({
  raw,
  poolEvent,
}: {
  raw: unknown;
  poolEvent: string;
}): HookDefinition | null {
  if (!isRecord(raw) || typeof raw.command !== "string" || raw.command === "") {
    return null;
  }
  const def: HookDefinition = { type: "command", command: raw.command };
  if (typeof raw.name === "string" && raw.name !== "") {
    def.name = raw.name;
  }
  // `*` and `""` both mean every tool, which is what an absent canonical
  // matcher means; on an event Pool never tests it against, the required
  // placeholder carries no information either.
  if (
    POOL_MATCHER_EVENTS.has(poolEvent) &&
    typeof raw.matcher === "string" &&
    raw.matcher !== "" &&
    raw.matcher !== POOL_MATCH_ALL
  ) {
    def.matcher = raw.matcher;
  }
  if (typeof raw.timeout === "number") {
    def.timeout = raw.timeout;
  }
  return def;
}

/**
 * Reverse {@link canonicalToPoolHooks}: parse the event lists of the `hooks`
 * block back into a canonical event → definition[] record. An event Pool does
 * not document is carried under its own name so `buildImportedHooksConfig`
 * files it under the `pool.hooks` override; a non-list sibling such as
 * `stop_hook_max_continuations` is not a hook and is left alone.
 */
function poolHooksToCanonical(hooksBlock: unknown): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  if (!isRecord(hooksBlock)) {
    return canonical;
  }
  for (const [poolEvent, rawEntries] of Object.entries(hooksBlock)) {
    // The lookup below is own-property-only, so a crafted event such as
    // "toString" falls back to the raw name; a prototype-pollution key would
    // still be written as a key of the canonical record, so it is skipped.
    if (isPrototypePollutionKey(poolEvent) || !Array.isArray(rawEntries)) {
      continue;
    }
    const canonicalEvent =
      lookupOwn({ record: POOL_TO_CANONICAL_EVENT_NAMES, key: poolEvent }) ?? poolEvent;
    const defs = rawEntries
      .map((raw) => poolEntryToCanonicalDef({ raw, poolEvent }))
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
 * The keys of an existing `hooks` block that are not event lists —
 * `stop_hook_max_continuations` and anything else Pool may add beside the
 * events — which survive a regenerate untouched.
 */
function nonEventHookKeys(hooksBlock: unknown): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  if (!isRecord(hooksBlock)) {
    return kept;
  }
  for (const [key, value] of Object.entries(hooksBlock)) {
    if (!isPrototypePollutionKey(key) && !Array.isArray(value)) {
      kept[key] = value;
    }
  }
  return kept;
}

/**
 * Pool hooks.
 *
 * Pool reads hooks from the `hooks` key of its settings file —
 * `.poolside/settings.yaml` at project scope and
 * `~/.config/poolside/settings.yaml` at user scope — as
 * `hooks.<Event>: [{name?, matcher, command, timeout?}]` for `PreToolUse`,
 * `PostToolUse`, `UserPromptSubmit`, `PreCompact`, `SessionStart` and `Stop`.
 * The event lists are rewritten as a whole; the block's non-list sibling
 * `stop_hook_max_continuations` and every other top-level key of the file
 * (`mcp_servers`, `tools`, `paths`, `pool`, ...) are preserved, and the file
 * is never deleted.
 *
 * @see https://docs.poolside.ai/hooks
 * @see https://docs.poolside.ai/settings-file-reference
 */
export class PoolHooks extends ToolHooks {
  private readonly settings: Record<string, unknown>;

  constructor(params: AiFileParams) {
    super(params);
    this.settings = parsePoolSettings(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getSettings(): Record<string, unknown> {
    return this.settings;
  }

  override isDeletable(): boolean {
    // settings.yaml is Pool's primary settings file, so it must never be
    // removed wholesale; clearing hooks happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: global ? POOL_GLOBAL_DIR : POOL_DIR,
      relativeFilePath: POOL_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<PoolHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new PoolHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
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
  }): Promise<PoolHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parsePoolSettings(existingContent, filePath);

    const config = rulesyncHooks.getJson();
    const hooks = canonicalToPoolHooks({
      config,
      toolOverride: config.pool?.hooks,
      logger,
    });

    return new PoolHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "hooks",
        existingContent,
        patch: {
          [POOL_HOOKS_KEY]: { ...nonEventHookKeys(existing[POOL_HOOKS_KEY]), ...hooks },
        },
        filePath,
        logger,
      }),
      validate,
      global,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    const hooks = poolHooksToCanonical(this.settings[POOL_HOOKS_KEY]);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "pool" }),
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
    global = false,
  }: ToolHooksForDeletionParams): PoolHooks {
    // The shared settings file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new PoolHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
