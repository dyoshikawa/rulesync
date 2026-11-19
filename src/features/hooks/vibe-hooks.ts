import * as smolToml from "smol-toml";

import type { ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_VIBE_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
  VIBE_HOOK_EVENTS,
  VIBE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const VIBE_DIR = ".vibe";
const VIBE_HOOKS_FILE_NAME = "hooks.toml";

/**
 * One serialized `[[hooks]]` entry in `.vibe/hooks.toml`.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
type VibeHookEntry = {
  name: string;
  type: string;
  match?: string;
  command: string;
  timeout?: number;
  strict?: boolean;
  description?: string;
};

/**
 * Vibe scopes the tool-name `match` glob to tool hooks (`pre_tool` /
 * `post_tool`). The other events take a `match` too, on something other than a
 * tool name: the agent whose turn it is on `post_agent` / `pre_agent` /
 * `pre_llm` / `post_llm`, and the source, reason or notification type on
 * `session_start` / `session_end` / `notification`.
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.1.3/vibe/plugins/builtins/vibe/skills/vibe/SKILL.md
 */
const VIBE_TOOL_EVENTS: ReadonlySet<string> = new Set(["pre_tool", "post_tool"]);

/**
 * The events where a failing hook may block, and so the only ones that accept
 * `strict`. Vibe's `HookConfig` validator rejects a `strict` entry of any
 * other type.
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.1.3/vibe/core/hooks/models.py
 */
const VIBE_STRICT_EVENTS: ReadonlySet<string> = new Set([
  "pre_tool",
  "post_tool",
  "pre_agent",
  "pre_llm",
  "post_llm",
]);

/** The Vibe event canonical `beforeSubmitPrompt` becomes. */
const VIBE_PRE_AGENT_EVENT = "pre_agent";

/** The Vibe event both canonical `stop` and `subagentStop` become. */
const VIBE_POST_AGENT_EVENT = "post_agent";

/**
 * The reserved agent alias a `post_agent` hook's `match` uses to run only
 * after the main agent. Without a `match`, `post_agent` runs after every
 * agent, subagents included (v3.0.2+), whereas canonical `stop` is
 * main-agent-only — so `stop` is written with this match.
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.0.3/README.md
 */
const VIBE_MAIN_AGENT_MATCH = "main";

/**
 * The `post_agent` `match` for a canonical `subagentStop` hook, or null to
 * skip it. Vibe has no selector for "every subagent but not the main agent",
 * so a matcher naming the subagent is required.
 */
function toVibeSubagentMatch({
  matcher,
  logger,
}: {
  matcher: unknown;
  logger: Logger | undefined;
}): string | null {
  if (typeof matcher !== "string" || matcher === "" || matcher === "*") {
    logger?.warn(
      'Vibe hooks: skipping a "subagentStop" hook without an agent-name matcher. Vibe\'s post_agent cannot select every subagent without also running after the main agent; set "matcher" to the subagent name.',
    );
    return null;
  }
  if (matcher.toLowerCase() === VIBE_MAIN_AGENT_MATCH) {
    logger?.warn(
      'Vibe hooks: skipping a "subagentStop" hook whose matcher is "main". Vibe reserves "main" for the main agent; use a "stop" hook instead.',
    );
    return null;
  }
  return matcher;
}

const SUPPORTED_VIBE_EVENTS: ReadonlySet<string> = new Set(VIBE_HOOK_EVENTS);

/**
 * The `match` a canonical `Bash` matcher becomes. Vibe tests `match` against a
 * tool's qualified name, its underscore form and its bare leaf, and "commands
 * the agent starts in the background go through `process_start`, which
 * `match = "bash"` does not catch" — so a verbatim `Bash` guard silently skips
 * every background command. The upstream README's own example is this regex.
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.0.2/README.md
 */
const VIBE_SHELL_HOOK_MATCH = "re:bash|process_start";

/** Translate a canonical tool matcher into Vibe's `match` value. */
function toVibeHookMatch(matcher: unknown): string {
  if (typeof matcher !== "string" || matcher === "") {
    return "*";
  }
  return matcher.toLowerCase() === "bash" ? VIBE_SHELL_HOOK_MATCH : matcher;
}

/** Reverse {@link toVibeHookMatch}; `undefined` means "any tool". */
function fromVibeHookMatch(match: unknown): string | undefined {
  if (typeof match !== "string" || match === "" || match === "*") {
    return undefined;
  }
  return match.toLowerCase() === VIBE_SHELL_HOOK_MATCH ? "Bash" : match;
}

/**
 * The `match` for an event whose matcher is not a tool name, or `undefined`
 * when the canonical matcher selects everything.
 */
function toVibeOptionalMatch(matcher: unknown): string | undefined {
  if (typeof matcher !== "string" || matcher === "" || matcher === "*") {
    return undefined;
  }
  return matcher;
}

/**
 * The `match` of the Vibe entry a canonical hook becomes: a string, `undefined`
 * to leave the key out, or null to skip the hook.
 */
function toVibeEntryMatch({
  event,
  vibeEvent,
  matcher,
  logger,
}: {
  event: string;
  vibeEvent: string;
  matcher: unknown;
  logger: Logger | undefined;
}): string | undefined | null {
  if (VIBE_TOOL_EVENTS.has(vibeEvent)) {
    // A canonical `Bash` matcher is widened to also catch background
    // commands (`process_start`).
    return toVibeHookMatch(matcher);
  }
  if (event === "subagentStop") {
    return toVibeSubagentMatch({ matcher, logger });
  }
  if (vibeEvent === VIBE_POST_AGENT_EVENT) {
    // Canonical `stop` is main-agent-only; a bare `post_agent` would also run
    // after every subagent.
    return VIBE_MAIN_AGENT_MATCH;
  }
  if (vibeEvent === VIBE_PRE_AGENT_EVENT) {
    // `pre_agent` runs before every agent's turn, subagents included, while
    // canonical `beforeSubmitPrompt` is about the user's prompt to the main
    // agent. An explicit agent matcher is kept so an imported hook scoped to
    // another agent round-trips.
    return toVibeOptionalMatch(matcher) ?? VIBE_MAIN_AGENT_MATCH;
  }
  // `pre_llm` / `post_llm` match the agent, `session_start` the source,
  // `session_end` the reason and `notification` the notification type.
  // Without a matcher the key is left out, so the hook runs for all.
  return toVibeOptionalMatch(matcher);
}

/**
 * The canonical event and matcher a Vibe entry's `type` and `match` become.
 */
function fromVibeEntryMatch({
  vibeEvent,
  canonicalEvent,
  match,
}: {
  vibeEvent: string;
  canonicalEvent: string;
  match: unknown;
}): { canonicalEvent: string; matcher: string | undefined } {
  if (VIBE_TOOL_EVENTS.has(vibeEvent)) {
    return { canonicalEvent, matcher: fromVibeHookMatch(match) };
  }
  const optionalMatch = toVibeOptionalMatch(match);
  const isMainAgent =
    optionalMatch === undefined || optionalMatch.toLowerCase() === VIBE_MAIN_AGENT_MATCH;
  if (vibeEvent === VIBE_POST_AGENT_EVENT) {
    // `match` names an agent here. `main` (or no match) is the main agent,
    // i.e. canonical `stop`; any other agent name is a `subagentStop` hook
    // scoped to that subagent.
    return isMainAgent
      ? { canonicalEvent, matcher: undefined }
      : { canonicalEvent: "subagentStop", matcher: optionalMatch };
  }
  if (vibeEvent === VIBE_PRE_AGENT_EVENT) {
    // `main` (or no match) is the default `beforeSubmitPrompt` writes; any
    // other agent is kept as the matcher.
    return { canonicalEvent, matcher: isMainAgent ? undefined : optionalMatch };
  }
  // Not a tool name, so the `Bash` widening is not reversed here.
  return { canonicalEvent, matcher: optionalMatch };
}

/**
 * Build the flat `[[hooks]]` array for `.vibe/hooks.toml` from a canonical
 * hooks config. Vibe uses a flat array where each entry carries its own event
 * `type`, `match` glob/regex (a tool name for tool hooks, an agent name for
 * `post_agent` / `pre_agent` / `pre_llm` / `post_llm`, a source, reason or
 * notification type for the session and notification hooks), and `command`.
 * Only `type: "command"` canonical hooks are emitted: a Vibe hook is a shell command line. (v2.25.1
 * to v2.25.4 briefly exec'd it without a shell under the unified harness and
 * skipped any command containing a backslash; v2.25.5 restored shell
 * execution — "Hook commands using pipes, `&&`, redirects, globs or `$VAR`
 * now run through the shell" — and dropped the backslash skip.)
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.0.2/README.md
 */
function canonicalToVibeHooks({
  config,
  toolOverride,
  logger,
}: {
  config: HooksConfig;
  toolOverride: HooksConfig["hooks"] | undefined;
  logger?: Logger;
}): {
  hooks: VibeHookEntry[];
} {
  const shared: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (SUPPORTED_VIBE_EVENTS.has(event)) {
      shared[event] = defs;
    }
  }
  const effective: HooksConfig["hooks"] = { ...shared, ...toolOverride };

  const hooks: VibeHookEntry[] = [];
  // Counted per Vibe event, not per canonical one: `stop` and `subagentStop`
  // both become `post_agent`, and their generated names must not collide.
  const nextIndexByVibeEvent = new Map<string, number>();
  for (const [event, defs] of Object.entries(effective)) {
    if (!SUPPORTED_VIBE_EVENTS.has(event)) {
      continue;
    }
    const vibeEvent = lookupOwn({ record: CANONICAL_TO_VIBE_EVENT_NAMES, key: event }) ?? event;
    for (const def of defs) {
      const hookType = def.type ?? "command";
      if (hookType !== "command") {
        continue;
      }
      if (typeof def.command !== "string") {
        continue;
      }
      const match = toVibeEntryMatch({ event, vibeEvent, matcher: def.matcher, logger });
      if (match === null) {
        continue;
      }
      const index = nextIndexByVibeEvent.get(vibeEvent) ?? 0;
      const name = typeof def.name === "string" ? def.name : `${vibeEvent}-${index}`;
      const entry: VibeHookEntry = {
        name,
        type: vibeEvent,
        ...(match !== undefined && { match }),
        command: def.command,
      };
      if (typeof def.timeout === "number") {
        entry.timeout = def.timeout;
      }
      // Vibe accepts `strict` only on the events where a hook may block. We
      // carry it through when present on the canonical definition (passed via
      // the loose `strict` key).
      const strict = (def as Record<string, unknown>).strict;
      if (VIBE_STRICT_EVENTS.has(vibeEvent) && typeof strict === "boolean") {
        entry.strict = strict;
      }
      if (typeof def.description === "string") {
        entry.description = def.description;
      }
      hooks.push(entry);
      nextIndexByVibeEvent.set(vibeEvent, index + 1);
    }
  }

  return { hooks };
}

/** Convert one raw `[[hooks]]` entry to a canonical definition, or null to skip. */
function vibeEntryToCanonicalDef(
  raw: unknown,
): { canonicalEvent: string; def: HookDefinition } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const vibeEvent = typeof entry.type === "string" ? entry.type : undefined;
  if (vibeEvent === undefined) {
    return null;
  }
  // The lookup below is own-property-only, so a crafted `type` such as
  // "toString" falls back to the raw name instead of a prototype member. The
  // raw name is still written as a key of the canonical record, so a
  // prototype-pollution key is skipped outright, as `kiroIdeHooksToCanonical`
  // does.
  if (isPrototypePollutionKey(vibeEvent)) {
    return null;
  }
  const mappedEvent =
    lookupOwn({ record: VIBE_TO_CANONICAL_EVENT_NAMES, key: vibeEvent }) ?? vibeEvent;
  const def: HookDefinition = { type: "command" };
  if (typeof entry.command === "string") {
    def.command = entry.command;
  }
  const resolved = fromVibeEntryMatch({
    // A pre-2.21.0 spelling (`before_tool`, ...) reads its `match` as the
    // current type does.
    vibeEvent: lookupOwn({ record: CANONICAL_TO_VIBE_EVENT_NAMES, key: mappedEvent }) ?? vibeEvent,
    canonicalEvent: mappedEvent,
    match: entry.match,
  });
  const canonicalEvent = resolved.canonicalEvent;
  if (resolved.matcher !== undefined) {
    def.matcher = resolved.matcher;
  }
  if (typeof entry.timeout === "number") {
    def.timeout = entry.timeout;
  }
  if (typeof entry.name === "string") {
    def.name = entry.name;
  }
  if (typeof entry.description === "string") {
    def.description = entry.description;
  }
  if (typeof entry.strict === "boolean") {
    (def as Record<string, unknown>).strict = entry.strict;
  }
  return { canonicalEvent, def };
}

/**
 * Reverse {@link canonicalToVibeHooks}: parse the flat `[[hooks]]` array back
 * into a canonical event → definition[] record.
 */
function vibeHooksToCanonical(parsed: unknown): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return canonical;
  }
  const rawHooks = (parsed as Record<string, unknown>).hooks;
  if (!Array.isArray(rawHooks)) {
    return canonical;
  }
  for (const raw of rawHooks) {
    const result = vibeEntryToCanonicalDef(raw);
    if (result === null) {
      continue;
    }
    const list = lookupOwn({ record: canonical, key: result.canonicalEvent }) ?? [];
    list.push(result.def);
    canonical[result.canonicalEvent] = list;
  }
  return canonical;
}

/** Vibe reads a `match` with a `re:` prefix or glob metacharacters as a pattern. */
const VIBE_PATTERN_MATCH = /^re:|[*?[]/;

/**
 * Move the imported `subagentStop` hooks into the `vibe` override when any of
 * them matches agents by a regex or glob rather than by a literal name. Such a
 * pattern can also select the main agent (a main session answers to its mode
 * name, e.g. `accept-edits`), and other tools would read it as their own
 * matcher syntax, so it is kept Vibe-only. The override replaces the shared
 * list for its event, so the whole list moves to keep every entry on Vibe.
 */
function takeVibeOnlySubagentStop({
  hooks,
  logger,
}: {
  hooks: HooksConfig["hooks"];
  logger?: Logger;
}): HookDefinition[] | undefined {
  const defs = lookupOwn({ record: hooks, key: "subagentStop" });
  if (
    defs === undefined ||
    !defs.some((def) => typeof def.matcher === "string" && VIBE_PATTERN_MATCH.test(def.matcher))
  ) {
    return undefined;
  }
  delete hooks.subagentStop;
  logger?.warn(
    "Vibe hooks: a post_agent hook matches agents by a pattern, so its subagentStop hooks are " +
      "imported into the vibe override instead of the shared hooks.",
  );
  return defs;
}

function parseVibeToml(fileContent: string): Record<string, unknown> {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

/**
 * Mistral Vibe hooks adapter.
 *
 * Emits the flat `[[hooks]]` array to `.vibe/hooks.toml` (project) or
 * `~/.vibe/hooks.toml` (global; the processor sets outputRoot to HOME).
 * v2.21.0 graduated hooks from experimental and removed the
 * `enable_experimental_hooks` flag, so declaring a hook is all that is needed
 * and no auxiliary `.vibe/config.toml` write happens.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/README.md
 */
export class VibeHooks extends ToolHooks {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return { relativeDirPath: VIBE_DIR, relativeFilePath: VIBE_HOOKS_FILE_NAME };
  }

  protected static override getMissingFileContent(): string {
    return smolToml.stringify({});
  }

  protected static override getDeletionFileContent(): string {
    return smolToml.stringify({});
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<VibeHooks> {
    const paths = this.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const vibeHooks = canonicalToVibeHooks({
      config,
      toolOverride: config.vibe?.hooks,
      logger,
    });
    const fileContent = smolToml.stringify(vibeHooks);

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(options: { logger?: Logger } = {}): RulesyncHooks {
    const parsed: Record<string, unknown> = this.parseFileContentOrThrow({
      displayName: "Vibe",
      parse: (fileContent) => parseVibeToml(fileContent),
    });
    const hooks = vibeHooksToCanonical(parsed);
    const vibeOnlySubagentStop = takeVibeOnlySubagentStop({ hooks, logger: options.logger });
    const config = buildImportedHooksConfig({ hooks, overrideKey: "vibe" });
    if (vibeOnlySubagentStop !== undefined) {
      const override = (config.vibe ?? {}) as { hooks?: HooksConfig["hooks"] };
      config.vibe = {
        ...override,
        hooks: { ...override.hooks, subagentStop: vibeOnlySubagentStop },
      };
    }
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      parseVibeToml(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Vibe hooks TOML: ${formatError(error)}`),
      };
    }
  }
}
