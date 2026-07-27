import { join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_HERMESAGENT_EVENT_NAMES,
  HERMESAGENT_HOOK_EVENTS,
  HERMESAGENT_NATIVE_HOOK_EVENTS,
  HERMESAGENT_TO_CANONICAL_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
} from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
import {
  getHermesagentRelativeDirPath,
  getHermesagentRulesyncOutputRoot,
} from "../../utils/hermesagent.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import {
  applySharedConfigPatch,
  HERMES_CONFIG_SHARED_FILE_KEY,
  parseSharedConfig,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
} from "./tool-hooks.js";

type HermesagentHooksParams = Omit<AiFileParams, "relativeDirPath" | "relativeFilePath">;

/** One serialized entry of a Hermes `hooks.<event>` array. */
type HermesHookEntry = {
  command: string;
  matcher?: string;
  timeout?: number;
};

/**
 * Canonical events that map to a Hermes tool-call event (`pre_tool_call` /
 * `post_tool_call`) and therefore carry a `matcher`. Every other supported
 * canonical event maps to a Hermes lifecycle event, which never accepts a
 * `matcher`.
 * @see https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/hooks.md
 */
const HERMESAGENT_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "pre_tool_call",
  "post_tool_call",
]);
const HERMESAGENT_CANONICAL_EVENTS: ReadonlySet<string> = new Set(HERMESAGENT_HOOK_EVENTS);
const HERMESAGENT_NATIVE_EVENTS: ReadonlySet<string> = new Set(HERMESAGENT_NATIVE_HOOK_EVENTS);

/**
 * Convert the canonical hooks config into Hermes's native
 * `hooks: { <event>: [{ matcher?, command, timeout? }] }` shape.
 *
 * Only `type: "command"` canonical hooks are emitted — Hermes shell hooks run
 * via `shlex.split`/`shell=False`, so `prompt`/`http` hooks have no native
 * equivalent and are skipped (the shared `HooksProcessor` already warns about
 * unsupported hook types centrally). `matcher` is only carried through for
 * `pre_tool_call`/`post_tool_call`; on any other event it is dropped with a
 * warning, mirroring how other adapters (e.g. AugmentCode) handle
 * matcher-less lifecycle events.
 */
function definitionsToHermesEntries({
  event,
  sourceEvent = event,
  definitions,
  logger,
}: {
  event: string;
  sourceEvent?: string;
  definitions: HookDefinition[];
  logger?: Logger;
}): HermesHookEntry[] {
  const supportsMatcher = HERMESAGENT_MATCHER_EVENTS.has(event);
  const entries: HermesHookEntry[] = [];
  for (const definition of definitions) {
    const hookType = definition.type ?? "command";
    if (
      hookType !== "command" ||
      typeof definition.command !== "string" ||
      definition.command === ""
    ) {
      continue;
    }

    const entry: HermesHookEntry = { command: definition.command };
    if (typeof definition.matcher === "string" && definition.matcher !== "") {
      if (supportsMatcher) {
        entry.matcher = definition.matcher;
      } else {
        logger?.warn(
          `matcher "${definition.matcher}" on "${sourceEvent}" hook will be ignored — Hermes Agent only supports matchers on pre_tool_call/post_tool_call`,
        );
      }
    }
    if (typeof definition.timeout === "number") {
      entry.timeout = definition.timeout;
    }
    entries.push(entry);
  }
  return entries;
}

function setHermesHookEntries({
  result,
  event,
  sourceEvent,
  definitions,
  logger,
}: {
  result: Record<string, HermesHookEntry[]>;
  event: string;
  sourceEvent?: string;
  definitions: HookDefinition[];
  logger?: Logger;
}): void {
  if (PROTOTYPE_POLLUTION_KEYS.has(event)) {
    return;
  }
  const entries = definitionsToHermesEntries({ event, sourceEvent, definitions, logger });
  if (entries.length > 0) {
    result[event] = entries;
  }
}

function canonicalToHermesHooks({
  config,
  toolOverrideHooks,
  logger,
}: {
  config: HooksConfig;
  toolOverrideHooks: HooksConfig["hooks"] | undefined;
  logger?: Logger;
}): Record<string, HermesHookEntry[]> {
  const result: Record<string, HermesHookEntry[]> = {};

  for (const [canonicalEvent, definitions] of Object.entries(config.hooks)) {
    if (!HERMESAGENT_CANONICAL_EVENTS.has(canonicalEvent)) {
      continue;
    }
    const nativeEvent = CANONICAL_TO_HERMESAGENT_EVENT_NAMES[canonicalEvent];
    if (nativeEvent) {
      setHermesHookEntries({
        result,
        event: nativeEvent,
        sourceEvent: canonicalEvent,
        definitions,
        logger,
      });
    }
  }

  for (const [canonicalEvent, definitions] of Object.entries(toolOverrideHooks ?? {})) {
    if (!HERMESAGENT_CANONICAL_EVENTS.has(canonicalEvent)) {
      continue;
    }
    const nativeEvent = CANONICAL_TO_HERMESAGENT_EVENT_NAMES[canonicalEvent];
    if (nativeEvent) {
      setHermesHookEntries({
        result,
        event: nativeEvent,
        sourceEvent: canonicalEvent,
        definitions,
        logger,
      });
    }
  }

  for (const [nativeEvent, definitions] of Object.entries(toolOverrideHooks ?? {})) {
    if (HERMESAGENT_CANONICAL_EVENTS.has(nativeEvent)) {
      continue;
    }
    if (!HERMESAGENT_NATIVE_EVENTS.has(nativeEvent)) {
      logger?.warn(
        `Hermes hook event "${nativeEvent}" is not documented by Hermes Agent v0.19.0; preserving it for forward compatibility.`,
      );
    }
    setHermesHookEntries({ result, event: nativeEvent, definitions, logger });
  }

  return result;
}

/**
 * Reverse {@link canonicalToHermesHooks}: parse Hermes's native
 * `hooks: { <event>: [...] }` map back into a canonical event → definition[]
 * record. Native events with no canonical equivalent (`pre_verify`,
 * `transform_tool_result`, ...) retain their native names so
 * {@link buildImportedHooksConfig} places them under `hermesagent.hooks`.
 */
function hermesHooksToCanonical(hooks: unknown): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) {
    return canonical;
  }

  for (const [nativeEvent, entries] of Object.entries(hooks as Record<string, unknown>)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(nativeEvent) || !Array.isArray(entries)) {
      continue;
    }
    const rulesyncEvent = HERMESAGENT_TO_CANONICAL_EVENT_NAMES[nativeEvent] ?? nativeEvent;

    const defs: HookDefinition[] = [];
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        continue;
      }
      const entry = raw as Record<string, unknown>;
      if (typeof entry.command !== "string") {
        continue;
      }
      const def: HookDefinition = { type: "command", command: entry.command };
      if (
        HERMESAGENT_MATCHER_EVENTS.has(nativeEvent) &&
        typeof entry.matcher === "string" &&
        entry.matcher !== ""
      ) {
        def.matcher = entry.matcher;
      }
      if (typeof entry.timeout === "number") {
        def.timeout = entry.timeout;
      }
      defs.push(def);
    }

    if (defs.length > 0) {
      canonical[rulesyncEvent] = defs;
    }
  }

  return canonical;
}

/**
 * Hermes Agent shell hooks.
 *
 * Hermes Agent registers shell-command hooks under the `hooks:` key of the
 * shared user config file `~/.hermes/config.yaml` (the HERMES_HOME directory;
 * global only — Hermes has no project-scoped hooks location). Hermes only runs
 * hooks declared under its fixed `VALID_HOOKS` event keys (`pre_tool_call`,
 * `post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_session_start`,
 * `on_session_end`, `subagent_start`, `subagent_stop`, ...); any other key is
 * silently ignored. Generation therefore maps canonical events onto the real
 * `VALID_HOOKS` keys and merges the resulting `hooks:` block into the existing
 * config instead of overwriting it, since that file also holds other Hermes
 * settings (model, `mcp_servers`, `command_allowlist`, ...).
 * @see https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/hooks.md
 */
export class HermesagentHooks extends ToolHooks {
  static getSettablePaths({ global = false }: { global?: boolean } = {}) {
    return {
      relativeDirPath: getHermesagentRelativeDirPath({
        global,
        relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      }),
      relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
    };
  }

  constructor(params: HermesagentHooksParams) {
    super({
      ...params,
      ...HermesagentHooks.getSettablePaths({ global: params.global }),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  override isDeletable(): boolean {
    // config.yaml holds other Hermes settings (model, mcp_servers,
    // command_allowlist, ...), so it must never be removed wholesale; clearing
    // hooks happens via an in-place merge instead.
    return false;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<HermesagentHooks> {
    const paths = this.getSettablePaths({ global });
    return new HermesagentHooks({
      outputRoot,
      fileContent: await readFileContent(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      ),
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    global = false,
  }: ToolHooksForDeletionParams): HermesagentHooks {
    return new HermesagentHooks({ outputRoot, fileContent: "", validate: false, global });
  }

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    this.fileContent = applySharedConfigPatch({
      fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
      feature: "hooks",
      existingContent: fileContent,
      patch: parseSharedConfig({ format: "yaml", fileContent: this.fileContent }),
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    const config = parseSharedConfig({ format: "yaml", fileContent: this.getFileContent() });
    const hooks = hermesHooksToCanonical(config.hooks);
    return this.toRulesyncHooksDefault({
      outputRoot: getHermesagentRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "hermesagent" }),
        null,
        2,
      ),
    });
  }

  static fromRulesyncHooks({
    outputRoot,
    rulesyncHooks,
    logger,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { logger?: Logger }): HermesagentHooks {
    const config = rulesyncHooks.getJson();
    const hermesHooks = canonicalToHermesHooks({
      config,
      toolOverrideHooks: config.hermesagent?.hooks,
      logger,
    });

    return new HermesagentHooks({
      outputRoot,
      fileContent: stringifySharedConfig({
        format: "yaml",
        document: { hooks: hermesHooks },
      }),
      global,
    });
  }
}
