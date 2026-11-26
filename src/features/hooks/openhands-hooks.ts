import { join } from "node:path";

import { OPENHANDS_DIR, OPENHANDS_HOOKS_FILE_NAME } from "../../constants/openhands-paths.js";
import {
  CANONICAL_TO_OPENHANDS_EVENT_NAMES,
  OPENHANDS_HOOK_EVENTS,
  OPENHANDS_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { capitalizedMatcherNames, replaceMatcherNames } from "./hook-matcher-tool-names.js";
import { readPreviouslyOwnedHooks } from "./hooks-ownership-lock.js";
import { mergeGeneratedHookLists } from "./preserve-unowned-hook-commands.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  buildImportedHooksConfig,
  canonicalToToolHooks,
  type ToolHooksConverterConfig,
  toolHooksToCanonical,
} from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Canonical (Claude Code) tool names and the OpenHands tool names that cover
 * them. OpenHands matches a matcher case-sensitively against its own tool
 * names (`terminal`, `file_editor`, ...), so `Bash` must become `terminal` or a
 * guard on it never runs. `terminal` is OpenHands' only shell-executing tool.
 * A name with several counterparts expands to all of them: file writes go
 * through `file_editor`, or through `apply_patch` on agents that swap the
 * editor for it (the GPT-5 preset).
 * @see https://docs.openhands.dev/openhands/usage/customization/hooks
 * @see https://docs.openhands.dev/cookbook/custom-agent-no-browser
 * @see https://docs.openhands.dev/sdk/guides/llm-gpt5-preset
 */
const CANONICAL_TO_OPENHANDS_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = {
  Bash: ["terminal"],
  Read: ["file_editor"],
  Write: ["file_editor", "apply_patch"],
  Edit: ["file_editor", "apply_patch"],
  MultiEdit: ["file_editor", "apply_patch"],
  Glob: ["glob"],
  Grep: ["grep"],
  TodoWrite: ["task_tracker"],
  Task: ["task"],
};

/** OpenHands tool names mapped back to the canonical name, for import. */
const OPENHANDS_TO_CANONICAL_TOOL_NAMES: Readonly<Record<string, string>> = {
  terminal: "Bash",
  file_editor: "Edit",
  apply_patch: "Edit",
  glob: "Glob",
  grep: "Grep",
  task_tracker: "TodoWrite",
  task: "Task",
};

/** Events whose hooks can deny a tool call, so a matcher that never matches makes the guard fail open. */
const TOOL_GATING_EVENTS: ReadonlySet<string> = new Set(["preToolUse"]);

/** Canonical events OpenHands checks the matcher on; every other event only runs `*` (or no) matchers. */
const TOOL_MATCHER_EVENTS: ReadonlySet<string> = new Set(["preToolUse", "postToolUse"]);

/** A matcher made only of plain names joined by `|`. */
const PLAIN_NAME_MATCHER_PATTERN = /^[A-Za-z0-9_]+(?:\|[A-Za-z0-9_]+)*$/;

/** Matchers that already mean every tool, on either side. */
const MATCH_ALL_MATCHERS: ReadonlySet<string> = new Set(["*", ".*"]);

function translateNames(names: readonly string[]): { translated: string[]; unknown: string[] } {
  const translated: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const mapped = lookupOwn({ record: CANONICAL_TO_OPENHANDS_TOOL_NAMES, key: name });
    if (mapped !== undefined) {
      translated.push(...mapped);
    } else if (/^[A-Z]/.test(name)) {
      // OpenHands' tool names are all lowercase snake_case, so a capitalized
      // name left untranslated can never match there.
      unknown.push(name);
      translated.push(name);
    } else {
      translated.push(name);
    }
  }
  return { translated: [...new Set(translated)], unknown };
}

/**
 * Translate a canonical matcher to OpenHands tool names. OpenHands treats a
 * matcher holding regex metacharacters as a regex tested with `re.fullmatch`,
 * and any other matcher as an exact name, so a translated plain-name list is
 * written as `a|b` (anchored by the full match).
 *
 * A `preToolUse` guard naming a tool rulesync cannot translate is written with
 * the `*` matcher (it runs before every tool call) instead of a matcher that
 * would never match, so the guard fails closed; on `postToolUse` such a name
 * is written as-is with a warning.
 */
function canonicalToOpenhandsMatcher({
  matcher,
  eventName,
  warn,
}: {
  matcher: string;
  eventName: string;
  warn: (message: string) => void;
}): string {
  const trimmed = matcher.trim();
  if (MATCH_ALL_MATCHERS.has(trimmed) || !TOOL_MATCHER_EVENTS.has(eventName)) {
    return matcher;
  }
  let result: string;
  let unknown: string[];
  if (PLAIN_NAME_MATCHER_PATTERN.test(trimmed)) {
    const names = translateNames(trimmed.split("|"));
    result = names.translated.join("|");
    unknown = names.unknown;
  } else {
    const grouped: Record<string, string> = Object.fromEntries(
      Object.entries(CANONICAL_TO_OPENHANDS_TOOL_NAMES).map(([canonical, tools]) => [
        canonical,
        tools.length === 1 ? (tools[0] ?? canonical) : `(?:${tools.join("|")})`,
      ]),
    );
    result = replaceMatcherNames(matcher, grouped);
    unknown = capitalizedMatcherNames(result);
  }
  if (unknown.length === 0) {
    return result;
  }
  const names = unknown.map((name) => quoteValueForWarning(name)).join(", ");
  if (TOOL_GATING_EVENTS.has(eventName)) {
    warn(
      `${names} in the "${eventName}" matcher ${quoteValueForWarning(matcher)} has no OpenHands ` +
        `tool name rulesync can translate it to, so the guard is written with the "*" matcher ` +
        `and runs before every OpenHands tool call.`,
    );
    return "*";
  }
  warn(
    `${names} in the "${eventName}" matcher ${quoteValueForWarning(matcher)} is not an OpenHands ` +
      `tool name, so it is written as-is and will likely never match there, and the hook will ` +
      `not run for that tool.`,
  );
  return result;
}

function openhandsToCanonicalMatcher(matcher: string): string {
  const trimmed = matcher.trim();
  if (PLAIN_NAME_MATCHER_PATTERN.test(trimmed)) {
    const names = trimmed
      .split("|")
      .map((name) => lookupOwn({ record: OPENHANDS_TO_CANONICAL_TOOL_NAMES, key: name }) ?? name);
    return [...new Set(names)].join("|");
  }
  return replaceMatcherNames(matcher, OPENHANDS_TO_CANONICAL_TOOL_NAMES);
}

/**
 * OpenHands' hook format: Claude Code's matcher groups under snake_case event
 * keys, command handlers only (`type`, `command`, `timeout` in seconds,
 * `async`). Matchers apply to the tool events only; OpenHands runs a hook on
 * any other event only when its matcher is `*` or absent, so a matcher there
 * is dropped with a warning.
 * @see https://docs.openhands.dev/openhands/usage/customization/hooks
 */
export const OPENHANDS_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: OPENHANDS_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_OPENHANDS_EVENT_NAMES,
  toolToCanonicalEventNames: OPENHANDS_TO_CANONICAL_EVENT_NAMES,
  // Hooks run with the working folder as their cwd, so `./` paths resolve
  // without a prefix (`OPENHANDS_PROJECT_DIR` is also exported to them).
  projectDirVar: "",
  supportedHookTypes: new Set(["command"]),
  booleanPassthroughFields: [{ canonical: "async", tool: "async", commandOnly: true }],
  noMatcherEvents: new Set(
    OPENHANDS_HOOK_EVENTS.filter((event) => !TOOL_MATCHER_EVENTS.has(event)),
  ),
  matcherTranslation: {
    toTool: canonicalToOpenhandsMatcher,
    toCanonical: openhandsToCanonicalMatcher,
  },
};

/** PascalCase (`PreToolUse`) to snake_case (`pre_tool_use`), as OpenHands folds event keys. */
function pascalToSnake(key: string): string {
  return key.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase();
}

/**
 * Bring a parsed `hooks.json` to its native shape: the optional
 * `{"hooks": {...}}` wrapper unwrapped and PascalCase event keys folded to
 * snake_case, the two alternate spellings OpenHands accepts.
 */
function normalizeOpenhandsHooks(parsed: unknown): Record<string, unknown> {
  if (!isPlainObject(parsed)) return {};
  const source = isPlainObject(parsed.hooks) ? parsed.hooks : parsed;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (isPrototypePollutionKey(key)) continue;
    result[pascalToSnake(key)] = value;
  }
  return result;
}

/**
 * Why OpenHands would reject a generated handler, or `undefined` when it loads
 * it. OpenHands validates `timeout` as an integer, and one invalid handler
 * makes it reject the whole `hooks.json`.
 */
function describeRejectedHandler(handler: Record<string, unknown>): string | undefined {
  const { timeout } = handler;
  if (timeout !== undefined && (typeof timeout !== "number" || !Number.isSafeInteger(timeout))) {
    return `its "timeout" ${JSON.stringify(timeout) ?? String(timeout)} is not a whole number of seconds, and OpenHands rejects the whole hooks file on such a handler`;
  }
  return undefined;
}

function filterRejectedHandlers({
  hooks,
  logger,
}: {
  hooks: Record<string, unknown[]>;
  logger?: Logger;
}): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const [eventName, groups] of Object.entries(hooks)) {
    const kept: unknown[] = [];
    for (const group of groups) {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const handlers = group.hooks.filter((handler: unknown) => {
        if (!isPlainObject(handler)) return true;
        const reason = describeRejectedHandler(handler);
        if (reason === undefined) return true;
        logger?.warn(`Skipping a hook on OpenHands "${eventName}": ${reason}.`);
        return false;
      });
      if (handlers.length > 0) kept.push({ ...group, hooks: handlers });
    }
    if (kept.length > 0) result[eventName] = kept;
  }
  return result;
}

/**
 * Drop the catch-all matcher from the non-tool events of an imported file. The
 * documented OpenHands examples write `"matcher": "*"` on `stop`, which the
 * canonical format would otherwise carry into every other tool's config (and
 * warn about on the next generate).
 */
function stripCatchAllMatchersOnNonToolEvents(
  hooks: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [eventName, groups] of Object.entries(hooks)) {
    const canonical = lookupOwn({ record: OPENHANDS_TO_CANONICAL_EVENT_NAMES, key: eventName });
    if (canonical === undefined || TOOL_MATCHER_EVENTS.has(canonical) || !Array.isArray(groups)) {
      result[eventName] = groups;
      continue;
    }
    result[eventName] = groups.map((group: unknown) => {
      if (!isPlainObject(group) || typeof group.matcher !== "string") return group;
      if (group.matcher.trim() !== "*" && group.matcher.trim() !== "") return group;
      const { matcher: _matcher, ...rest } = group;
      return rest;
    });
  }
  return result;
}

/**
 * Hooks generator for OpenHands: `.openhands/hooks.json` in the project root,
 * written with the documented snake_case event keys and no wrapper. OpenHands
 * documents no user-level hooks file, so global mode is not supported.
 *
 * By default the generated hooks replace the file; with
 * `preserveUnownedHooks`, handlers rulesync did not write are kept and an
 * imported handler is not written twice.
 *
 * @see https://docs.openhands.dev/openhands/usage/customization/hooks
 */
export class OpenhandsHooks extends ToolHooks {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: OPENHANDS_DIR,
      relativeFilePath: OPENHANDS_HOOKS_FILE_NAME,
    };
  }

  protected static override getMissingFileContent(): string {
    return "{}";
  }

  protected static override getDeletionFileContent(): string {
    return JSON.stringify({}, null, 2);
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    preserveUnowned = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<OpenhandsHooks> {
    const paths = OpenhandsHooks.getSettablePaths();
    const toolHooks = filterRejectedHandlers({
      hooks: canonicalToToolHooks({
        config: rulesyncHooks.getJson(),
        toolOverrideHooks: rulesyncHooks.getJson().openhands?.hooks,
        converterConfig: OPENHANDS_CONVERTER_CONFIG,
        logger,
      }),
      logger,
    });

    let existingContent = "";
    if (preserveUnowned) {
      const raw =
        (await readFileContentOrNull(
          join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
        )) ?? "";
      existingContent = raw;
      if (raw.trim() !== "") {
        try {
          // The shared merge reads a `{ hooks }` document; feed it the
          // existing file in that shape with OpenHands' alternate spellings
          // folded, so a hand-written `PreToolUse` group meets the generated
          // `pre_tool_use` one.
          existingContent = JSON.stringify({ hooks: normalizeOpenhandsHooks(JSON.parse(raw)) });
        } catch {
          // Left as read: the merge reports the file as malformed.
        }
      }
    }
    const previouslyOwned = preserveUnowned
      ? await readPreviouslyOwnedHooks({ outputRoot, relativeDirPath: paths.relativeDirPath })
      : undefined;
    const merged = mergeGeneratedHookLists({
      existingContent,
      generatedHooks: toolHooks,
      shape: "matcher-groups",
      preserveUnowned,
      previouslyOwned,
      logger,
    });

    return new OpenhandsHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(merged.hooks, null, 2),
      ownedHookRefs: preserveUnowned ? merged.owned : undefined,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const parsed: unknown = this.parseFileContentOrThrow({
      displayName: "OpenHands",
      parse: (fileContent) => JSON.parse(fileContent),
    });
    const hooks = toolHooksToCanonical({
      hooks: stripCatchAllMatchersOnNonToolEvents(normalizeOpenhandsHooks(parsed)),
      converterConfig: OPENHANDS_CONVERTER_CONFIG,
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ logger, hooks, overrideKey: "openhands" }),
        null,
        2,
      ),
    });
  }

  static override supportsPreserveUnowned(): boolean {
    return true;
  }
}
