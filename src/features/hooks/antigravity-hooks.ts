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
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import { canonicalToToolHooks, toolHooksToCanonical } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Antigravity uses a Claude-Code-like `hooks.json` (matcher shape). The
 * `PreToolUse`/`PostToolUse` events use the matcher-based array shape, while
 * `PreInvocation`/`PostInvocation`/`Stop` are matcher-less handler lists.
 * `projectDirVar` is empty because Antigravity does not document a
 * project-directory variable for commands.
 */
const ANTIGRAVITY_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: ANTIGRAVITY_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_ANTIGRAVITY_EVENT_NAMES,
  toolToCanonicalEventNames: ANTIGRAVITY_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  noMatcherEvents: new Set(["preModelInvocation", "postModelInvocation", "stop"]),
};

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
 * The per-hook `enabled` flag is ignored (canonical hooks have no equivalent).
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
    const existing = Object.hasOwn(flat, event) ? flat[event] : undefined;
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
 * value holds the Claude-Code-style event → matcher-entry map
 * (`{ "<name>": { "<Event>": [...] } }`). Project and global modes share the
 * same shape; only the location differs (`.agents/hooks.json` vs
 * `~/.gemini/config/hooks.json`).
 *
 * The IDE and CLI targets share identical paths, so all logic lives on this
 * base class; the two concrete subclasses differ only in which per-target
 * override key (`antigravity-ide` / `antigravity-cli`) they read from the
 * rulesync hooks config.
 */
export class AntigravityHooks extends ToolHooks {
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
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // hooks.json is dedicated to hooks, so any existing content is fully
    // replaced; reading it first keeps a stable round-trip when unchanged.
    await readOrInitializeFileContent(filePath, JSON.stringify({}, null, 2));

    const config = rulesyncHooks.getJson();
    const eventMap = canonicalToToolHooks({
      config,
      toolOverrideHooks: config[this.getOverrideKey()]?.hooks,
      converterConfig: ANTIGRAVITY_CONVERTER_CONFIG,
      logger,
    });
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

  toRulesyncHooks(): RulesyncHooks {
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
      hooks: flattenAntigravityHooks(parsed),
      converterConfig: ANTIGRAVITY_CONVERTER_CONFIG,
    });
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
