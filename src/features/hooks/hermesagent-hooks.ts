import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_HERMESAGENT_EVENT_NAMES,
  HERMESAGENT_HOOK_EVENTS,
  HERMESAGENT_TO_CANONICAL_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
} from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { mergeHermesConfig, parseHermesConfig, stringifyHermesConfig } from "../hermes-config.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { ToolHooks, type ToolHooksFromRulesyncHooksParams } from "./tool-hooks.js";

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
const HERMESAGENT_MATCHER_EVENTS: ReadonlySet<string> = new Set(["preToolUse", "postToolUse"]);

/**
 * Filter the shared canonical hooks to the events Hermes understands and merge
 * the `hermesagent`-specific override block on top.
 */
function buildEffectiveHooks(
  config: HooksConfig,
  toolOverrideHooks: HooksConfig["hooks"] | undefined,
): HooksConfig["hooks"] {
  const supported: Set<string> = new Set(HERMESAGENT_HOOK_EVENTS);
  const shared: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      shared[event] = defs;
    }
  }
  return { ...shared, ...toolOverrideHooks };
}

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
function canonicalToHermesHooks({
  config,
  toolOverrideHooks,
  logger,
}: {
  config: HooksConfig;
  toolOverrideHooks: HooksConfig["hooks"] | undefined;
  logger?: Logger;
}): Record<string, HermesHookEntry[]> {
  const effectiveHooks = buildEffectiveHooks(config, toolOverrideHooks);
  const result: Record<string, HermesHookEntry[]> = {};

  for (const [canonicalEvent, defs] of Object.entries(effectiveHooks)) {
    const nativeEvent = CANONICAL_TO_HERMESAGENT_EVENT_NAMES[canonicalEvent];
    if (!nativeEvent) {
      continue;
    }

    const supportsMatcher = HERMESAGENT_MATCHER_EVENTS.has(canonicalEvent);
    const entries: HermesHookEntry[] = [];
    for (const def of defs) {
      const hookType = def.type ?? "command";
      if (hookType !== "command") {
        continue;
      }
      if (typeof def.command !== "string" || def.command === "") {
        continue;
      }

      const entry: HermesHookEntry = { command: def.command };
      if (typeof def.matcher === "string" && def.matcher !== "") {
        if (supportsMatcher) {
          entry.matcher = def.matcher;
        } else {
          logger?.warn(
            `matcher "${def.matcher}" on "${canonicalEvent}" hook will be ignored — Hermes Agent only supports matchers on pre_tool_call/post_tool_call`,
          );
        }
      }
      if (typeof def.timeout === "number") {
        entry.timeout = def.timeout;
      }
      entries.push(entry);
    }

    if (entries.length > 0) {
      result[nativeEvent] = entries;
    }
  }

  return result;
}

/**
 * Reverse {@link canonicalToHermesHooks}: parse Hermes's native
 * `hooks: { <event>: [...] }` map back into a canonical event → definition[]
 * record. Native events with no canonical equivalent (`pre_verify`,
 * `transform_tool_result`, ...) are skipped since there is nothing to round
 * -trip them into.
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
    const canonicalEvent = HERMESAGENT_TO_CANONICAL_EVENT_NAMES[nativeEvent];
    if (!canonicalEvent) {
      continue;
    }

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
      if (typeof entry.matcher === "string" && entry.matcher !== "") {
        def.matcher = entry.matcher;
      }
      if (typeof entry.timeout === "number") {
        def.timeout = entry.timeout;
      }
      defs.push(def);
    }

    if (defs.length > 0) {
      canonical[canonicalEvent] = defs;
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
  static getSettablePaths() {
    return {
      relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
    };
  }

  constructor(params: HermesagentHooksParams) {
    super({
      ...params,
      ...HermesagentHooks.getSettablePaths(),
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

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    this.fileContent = mergeHermesConfig(fileContent, parseHermesConfig(this.fileContent));
  }

  toRulesyncHooks(): RulesyncHooks {
    const config = parseHermesConfig(this.getFileContent());
    const hooks = hermesHooksToCanonical(config.hooks);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
    });
  }

  static fromRulesyncHooks({
    outputRoot,
    rulesyncHooks,
    logger,
  }: ToolHooksFromRulesyncHooksParams & { logger?: Logger }): HermesagentHooks {
    const config = rulesyncHooks.getJson();
    const hermesHooks = canonicalToHermesHooks({
      config,
      toolOverrideHooks: config.hermesagent?.hooks,
      logger,
    });

    return new HermesagentHooks({
      outputRoot,
      fileContent: stringifyHermesConfig({
        hooks: hermesHooks,
      }),
    });
  }
}
