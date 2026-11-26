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
import {
  isMatcherName,
  MATCHER_TOKEN_PATTERN,
  replaceMatcherNames,
} from "./hook-matcher-tool-names.js";
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

/** OpenHands tools that write files: the default editor, the GPT-5 preset's `apply_patch`, the Gemini preset's `write_file` / `edit` and the planning agent's editor (which edits its PLAN.md). */
const OPENHANDS_WRITE_TOOLS = [
  "file_editor",
  "apply_patch",
  "write_file",
  "edit",
  "planning_file_editor",
] as const;

/**
 * Canonical (Claude Code) tool names and the OpenHands tool names that cover
 * them. OpenHands matches a matcher case-sensitively against its own tool
 * names (`terminal`, `file_editor`, ...), so `Bash` must become `terminal` or a
 * guard on it never runs. `terminal` is OpenHands' only shell-executing tool.
 * A name with several counterparts expands to all of them, so a guard covers
 * every agent preset: the default one (`file_editor`), GPT-5 (`apply_patch`),
 * Gemini (`read_file`, `write_file`, `edit`, `list_directory`) and planning
 * (`planning_file_editor`). The three write names share one set, since every
 * write tool there can both create and edit a file.
 * @see https://docs.openhands.dev/openhands/usage/customization/hooks
 * @see https://docs.openhands.dev/sdk/guides/llm-gpt5-preset
 * @see https://github.com/OpenHands/software-agent-sdk/tree/main/openhands-tools/openhands/tools/preset
 */
const CANONICAL_TO_OPENHANDS_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = {
  Bash: ["terminal"],
  Read: ["file_editor", "read_file", "planning_file_editor"],
  Write: OPENHANDS_WRITE_TOOLS,
  Edit: OPENHANDS_WRITE_TOOLS,
  MultiEdit: OPENHANDS_WRITE_TOOLS,
  LS: ["list_directory"],
  Glob: ["glob"],
  Grep: ["grep"],
  TodoWrite: ["task_tracker"],
  Task: ["task"],
};

/**
 * OpenHands tool names mapped back to every canonical name that covers them,
 * for import. A tool that serves several canonical names widens to all of
 * them (`file_editor` -> `Read|Write|Edit|MultiEdit`), so an imported guard
 * keeps covering what it covered in OpenHands.
 */
const OPENHANDS_TO_CANONICAL_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = (() => {
  const result: Record<string, string[]> = {};
  for (const [canonical, tools] of Object.entries(CANONICAL_TO_OPENHANDS_TOOL_NAMES)) {
    for (const tool of tools) {
      (result[tool] ??= []).push(canonical);
    }
  }
  return result;
})();

/** Events whose hooks can deny a tool call, so a matcher that never matches makes the guard fail open. */
const TOOL_GATING_EVENTS: ReadonlySet<string> = new Set(["preToolUse"]);

/** Canonical events OpenHands checks the matcher on; every other event only runs `*` (or no) matchers. */
const TOOL_MATCHER_EVENTS: ReadonlySet<string> = new Set(["preToolUse", "postToolUse"]);

/** A matcher made only of plain names joined by `|`. */
const PLAIN_NAME_MATCHER_PATTERN = /^[A-Za-z0-9_]+(?:\|[A-Za-z0-9_]+)*$/;

/** Matchers that already mean every tool, on either side. */
const MATCH_ALL_MATCHERS: ReadonlySet<string> = new Set(["*", ".*", ""]);

/** Whole names of a matcher (escapes and character classes excluded). */
function matcherNames(matcher: string): string[] {
  return [...matcher.matchAll(MATCHER_TOKEN_PATTERN)]
    .map(([token]) => token)
    .filter((token) => isMatcherName(token));
}

/**
 * Names OpenHands can never match after translation: a capitalized name (its
 * tool names are lowercase snake_case) or a canonical `mcp__<server>__<tool>`
 * name (OpenHands calls an MCP tool by its own name, or `<server>_<tool>`).
 */
function unmatchableNames(matcher: string): string[] {
  return [
    ...new Set(
      matcherNames(matcher).filter((name) => /^[A-Z]/.test(name) || name.startsWith("mcp__")),
    ),
  ];
}

/** `(?:a|b)` for several names, the name itself for one. */
function alternation(names: readonly string[]): string {
  return names.length === 1 ? (names[0] ?? "") : `(?:${names.join("|")})`;
}

/**
 * Rewrite the names of a matcher through `table`. A plain `a|b` list becomes
 * a deduplicated plain list; inside a regex a name with several counterparts
 * becomes a `(?:...)` group.
 */
function rewriteMatcherNames(
  matcher: string,
  table: Readonly<Record<string, readonly string[]>>,
): string {
  const trimmed = matcher.trim();
  if (PLAIN_NAME_MATCHER_PATTERN.test(trimmed)) {
    const names = trimmed
      .split("|")
      .flatMap((name) => lookupOwn({ record: table, key: name }) ?? [name]);
    return [...new Set(names)].join("|");
  }
  const grouped: Record<string, string> = Object.fromEntries(
    Object.entries(table).map(([name, mapped]) => [name, alternation(mapped)]),
  );
  return replaceMatcherNames(matcher, grouped);
}

/**
 * Translate a canonical matcher to OpenHands tool names. OpenHands treats a
 * matcher holding regex metacharacters as a regex tested with `re.fullmatch`,
 * and any other matcher as an exact name, so a translated plain-name list is
 * written as `a|b` (anchored by the full match).
 *
 * A `preToolUse` guard naming a tool rulesync cannot translate (a capitalized
 * name without an OpenHands counterpart, or a canonical `mcp__...` name) is
 * written with the `*` matcher (it runs before every tool call) instead of a
 * matcher that would never match, so the guard fails closed; on `postToolUse`
 * such a name is written as-is with a warning.
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
  if (MATCH_ALL_MATCHERS.has(matcher.trim()) || !TOOL_MATCHER_EVENTS.has(eventName)) {
    return matcher;
  }
  const result = rewriteMatcherNames(matcher, CANONICAL_TO_OPENHANDS_TOOL_NAMES);
  const unknown = unmatchableNames(result);
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

/**
 * Translate an OpenHands matcher back to canonical names. The explicit
 * `/regex/` form is unwrapped first: OpenHands full-matches it the same way as
 * an auto-detected regex, while other tools would read the slashes literally.
 */
function openhandsToCanonicalMatcher(matcher: string): string {
  const trimmed = matcher.trim();
  const unwrapped =
    trimmed.length > 2 && trimmed.startsWith("/") && trimmed.endsWith("/")
      ? trimmed.slice(1, -1)
      : matcher;
  return rewriteMatcherNames(unwrapped, OPENHANDS_TO_CANONICAL_TOOL_NAMES);
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
 * Bring a generated handler's `timeout` to what OpenHands loads: it validates
 * `timeout` as an integer, and one invalid handler makes it reject the whole
 * `hooks.json`. A fractional positive timeout is rounded up to whole seconds;
 * any other non-integer value is left out (OpenHands then applies its 60s
 * default), so the hook itself is always kept.
 */
function normalizeTimeout({
  handler,
  eventName,
  logger,
}: {
  handler: Record<string, unknown>;
  eventName: string;
  logger?: Logger;
}): Record<string, unknown> {
  const { timeout } = handler;
  if (timeout === undefined || (typeof timeout === "number" && Number.isSafeInteger(timeout))) {
    return handler;
  }
  const shown = JSON.stringify(timeout) ?? String(timeout);
  if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0) {
    const rounded = Math.ceil(timeout);
    logger?.warn(
      `OpenHands "${eventName}" hook timeout ${shown} is not a whole number of seconds, which OpenHands rejects, so it is written as ${rounded}.`,
    );
    return { ...handler, timeout: rounded };
  }
  logger?.warn(
    `OpenHands "${eventName}" hook timeout ${shown} is not a whole number of seconds, which OpenHands rejects, so it is left out (OpenHands defaults to 60).`,
  );
  const { timeout: _timeout, ...rest } = handler;
  return rest;
}

function normalizeTimeouts({
  hooks,
  logger,
}: {
  hooks: Record<string, unknown[]>;
  logger?: Logger;
}): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const [eventName, groups] of Object.entries(hooks)) {
    result[eventName] = groups.map((group) => {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) return group;
      return {
        ...group,
        hooks: group.hooks.map((handler: unknown) =>
          isPlainObject(handler) ? normalizeTimeout({ handler, eventName, logger }) : handler,
        ),
      };
    });
  }
  return result;
}

/**
 * Prepare the matchers on the non-tool events of an imported file. OpenHands
 * runs a hook there only when its matcher is `*` or absent: the catch-all is
 * dropped (the documented examples write `"matcher": "*"` on `stop`), and a
 * group with any other matcher never runs in OpenHands, so it is skipped with
 * a warning rather than imported as a hook that would run on every
 * regenerate.
 */
function prepareNonToolEventMatchers({
  hooks,
  logger,
}: {
  hooks: Record<string, unknown>;
  logger?: Logger;
}): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [eventName, groups] of Object.entries(hooks)) {
    const canonical = lookupOwn({ record: OPENHANDS_TO_CANONICAL_EVENT_NAMES, key: eventName });
    if (canonical === undefined || TOOL_MATCHER_EVENTS.has(canonical) || !Array.isArray(groups)) {
      result[eventName] = groups;
      continue;
    }
    result[eventName] = groups.flatMap((group: unknown) => {
      if (!isPlainObject(group) || group.matcher === undefined) return [group];
      const matcher = typeof group.matcher === "string" ? group.matcher.trim() : undefined;
      if (matcher === "*" || matcher === "") {
        const { matcher: _matcher, ...rest } = group;
        return [rest];
      }
      logger?.warn(
        `Skipping an OpenHands "${eventName}" hook group with the matcher ` +
          `${quoteValueForWarning(String(group.matcher))}: OpenHands only runs hooks on this ` +
          `event when the matcher is "*" or absent, so it never runs there.`,
      );
      return [];
    });
  }
  return result;
}

/**
 * Hooks generator for OpenHands: `.openhands/hooks.json` in the project root,
 * written with the documented snake_case event keys and no wrapper. OpenHands
 * documents no user-level hooks file, so global mode is not supported. (The
 * SDK loader falls back to `~/.openhands/hooks.json` only when the project has
 * no `.openhands/hooks.json`, so a generated project file hides it.)
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
    const toolHooks = normalizeTimeouts({
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
      hooks: prepareNonToolEventMatchers({ hooks: normalizeOpenhandsHooks(parsed), logger }),
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
