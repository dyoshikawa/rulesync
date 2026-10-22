import { join } from "node:path";

import {
  ANTIGRAVITY_DIR,
  ANTIGRAVITY_GLOBAL_CONFIG_DIR_PATH,
  ANTIGRAVITY_HOOKS_FILE_NAME,
} from "../../constants/antigravity-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  ANTIGRAVITY_HOOK_EVENTS,
  ANTIGRAVITY_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_ANTIGRAVITY_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import {
  buildImportedHooksConfig,
  canonicalToToolHooks,
  toolHooksToCanonical,
} from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Canonical events whose Antigravity counterparts (`SessionStart`,
 * `PreInvocation`, `PostInvocation`, `Stop`) take no matcher.
 */
const ANTIGRAVITY_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "sessionStart",
  "preModelInvocation",
  "postModelInvocation",
  "stop",
]);

/**
 * Antigravity event names whose value is a flat list of handlers
 * (`"Stop": [ { "type": "command", "command": "..." } ]`) rather than a list
 * of `{ "matcher", "hooks": [...] }` groups. Antigravity's loader rejects a
 * wrapped group under these events ("command hook must specify 'command'")
 * and then skips the whole `hooks.json`.
 * https://antigravity.google/docs/hooks
 */
const ANTIGRAVITY_FLAT_HANDLER_EVENTS: ReadonlySet<string> = new Set(
  [...ANTIGRAVITY_NO_MATCHER_EVENTS].map(
    (event) => lookupOwn({ record: CANONICAL_TO_ANTIGRAVITY_EVENT_NAMES, key: event }) ?? event,
  ),
);

/**
 * Antigravity uses a Claude-Code-like `hooks.json`. The `PreToolUse` /
 * `PostToolUse` events use the matcher-based group shape, while `SessionStart`,
 * `PreInvocation`, `PostInvocation` and `Stop` are flat handler lists (see
 * {@link toAntigravityEventMap}). `projectDirVar` is empty because Antigravity
 * does not document a project-directory variable for commands.
 */
const ANTIGRAVITY_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: ANTIGRAVITY_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_ANTIGRAVITY_EVENT_NAMES,
  toolToCanonicalEventNames: ANTIGRAVITY_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  noMatcherEvents: ANTIGRAVITY_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command"]),
};

/**
 * Turn the shared converter's matcher-group output into Antigravity's shape:
 * the matcher-less events get their handlers directly under the event key.
 */
function toAntigravityEventMap(eventMap: Record<string, unknown[]>): Record<string, unknown[]> {
  return Object.fromEntries(
    Object.entries(eventMap).map(([event, entries]) => {
      if (!ANTIGRAVITY_FLAT_HANDLER_EVENTS.has(event)) {
        return [event, entries];
      }
      const handlers = entries.flatMap((entry) =>
        isPlainObject(entry) && Array.isArray(entry.hooks) ? entry.hooks : [],
      );
      return [event, handlers];
    }),
  );
}

/**
 * Reverse of {@link toAntigravityEventMap} for import: wrap each flat handler
 * of a matcher-less event in a `{ hooks: [...] }` group so the shared converter
 * can read it. An entry that is already a group (`{ hooks: [...] }`, as older
 * rulesync versions wrote) is kept as is.
 */
function toMatcherGroupEventMap(eventMap: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(eventMap).map(([event, entries]) => {
      if (!ANTIGRAVITY_FLAT_HANDLER_EVENTS.has(event) || !Array.isArray(entries)) {
        return [event, entries];
      }
      const groups = entries.map((entry) =>
        isPlainObject(entry) && !("hooks" in entry) ? { hooks: [entry] } : entry,
      );
      return [event, groups];
    }),
  );
}

/**
 * Antigravity's `hooks.json` is keyed by a named hook whose value holds the
 * per-event map (plus an optional `enabled` flag). rulesync writes a single
 * generated hook under this stable name.
 */
const ANTIGRAVITY_HOOK_NAME = "rulesync";

/**
 * Flatten Antigravity's named-hook wrapper into a single event → matcher-entry
 * map for import. Accepts both the documented named-hook shape
 * (`{ "<name>": { "<Event>": [...], "enabled"?: bool } }`) and a legacy flat
 * shape (`{ "<Event>": [...] }`) so older or hand-written files still import.
 * The per-hook `enabled` flag is ignored. The canonical `enabled` field is a
 * property of a single hook definition, whereas Antigravity's flag gates a whole
 * named group, so the two do not map onto each other.
 */
function flattenAntigravityHooks(parsed: unknown): Record<string, unknown> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const flat: Record<string, unknown[]> = {};
  const addEvent = (event: string, entries: unknown): void => {
    // Skip prototype-pollution keys (e.g. `__proto__`) so a crafted hooks file
    // cannot resolve `flat[event]` to `Object.prototype` (truthy but not
    // iterable), which would crash the spread below, or otherwise walk the
    // prototype chain. `Object.hasOwn` adds defense-in-depth for the lookup.
    if (isPrototypePollutionKey(event) || !Array.isArray(entries)) {
      return;
    }
    const existing = lookupOwn({ record: flat, key: event });
    flat[event] = existing ? [...existing, ...entries] : [...entries];
  };
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      // Legacy flat shape: the top-level key is the event name itself.
      addEvent(key, value);
    } else if (value !== null && typeof value === "object") {
      // Named-hook wrapper: the top-level key is a hook name; merge its events.
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (innerKey === "enabled") {
          continue;
        }
        addEvent(innerKey, innerValue);
      }
    }
  }
  return flat;
}

type AntigravityOverrideKey = "antigravity-ide" | "antigravity-cli";

/**
 * Hooks generator for Google Antigravity (both the IDE and the CLI).
 *
 * Antigravity writes a dedicated `hooks.json` keyed by a named hook whose
 * value holds the event map (`{ "<name>": { "<Event>": [...] } }`): matcher
 * groups for the tool events, flat handler lists for the others. Project and global modes share the
 * same shape; only the location differs (`.agents/hooks.json` vs
 * `~/.gemini/config/hooks.json`).
 *
 * The IDE and CLI targets share identical paths, so all logic lives on this
 * base class; the two concrete subclasses differ only in which per-target
 * override key (`antigravity-ide` / `antigravity-cli`) they read from the
 * rulesync hooks config.
 */
class AntigravityHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /** Per-target override key in the rulesync hooks config. */
  protected static getOverrideKey(): AntigravityOverrideKey {
    throw new Error("Please implement this method in the subclass.");
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    if (global) {
      // Shared global hooks location for both the IDE and the CLI.
      return {
        relativeDirPath: ANTIGRAVITY_GLOBAL_CONFIG_DIR_PATH,
        relativeFilePath: ANTIGRAVITY_HOOKS_FILE_NAME,
      };
    }
    return { relativeDirPath: ANTIGRAVITY_DIR, relativeFilePath: ANTIGRAVITY_HOOKS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<AntigravityHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new this({
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
  }): Promise<AntigravityHooks> {
    const paths = this.getSettablePaths({ global });
    // hooks.json is dedicated to hooks, so any existing content is fully
    // replaced; the write happens later in `writeAiFiles`.
    const config = rulesyncHooks.getJson();
    const eventMap = toAntigravityEventMap(
      canonicalToToolHooks({
        config,
        toolOverrideHooks: config[this.getOverrideKey()]?.hooks,
        converterConfig: ANTIGRAVITY_CONVERTER_CONFIG,
        logger,
      }),
    );
    // Antigravity expects the event map nested under a named hook
    // (`{ "<name>": { "<Event>": [...] } }`), not flat at the top level.
    const antigravityHooks =
      Object.keys(eventMap).length > 0 ? { [ANTIGRAVITY_HOOK_NAME]: eventMap } : {};
    const fileContent = JSON.stringify(antigravityHooks, null, 2);

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Antigravity hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: toMatcherGroupEventMap(flattenAntigravityHooks(parsed)),
      converterConfig: ANTIGRAVITY_CONVERTER_CONFIG,
      logger,
    });
    const overrideKey = (this.constructor as typeof AntigravityHooks).getOverrideKey();
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(buildImportedHooksConfig({ hooks, overrideKey }), null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): AntigravityHooks {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({}, null, 2),
      validate: false,
    });
  }
}

/** Antigravity IDE hooks (`antigravity-ide` target). */
export class AntigravityIdeHooks extends AntigravityHooks {
  protected static override getOverrideKey(): AntigravityOverrideKey {
    return "antigravity-ide";
  }
}

/** Antigravity CLI hooks (`antigravity-cli` target). */
export class AntigravityCliHooks extends AntigravityHooks {
  protected static override getOverrideKey(): AntigravityOverrideKey {
    return "antigravity-cli";
  }
}
