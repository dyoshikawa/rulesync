import { join } from "node:path";

import { ZERO_DIR, ZERO_HOOKS_FILE_NAME, zeroGlobalConfigDir } from "../../constants/zero-paths.js";
import {
  CANONICAL_TO_ZERO_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
  ZERO_HOOK_EVENTS,
  ZERO_MATCHER_EVENTS,
  ZERO_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig, warnOnce } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * One entry of the `hooks` array in Zero's `hooks.json`.
 * @see https://github.com/Twigpine/zero/blob/main/internal/hooks/hooks.go
 */
type ZeroHookEntry = {
  id: string;
  name?: string;
  event: string;
  matcher?: string;
  command: string;
  args: string[];
  enabled: boolean;
};

/**
 * Hook ids rulesync generates start with this prefix. Generation replaces the
 * entries carrying it and keeps every other entry (`zero hooks` writes the
 * same file), so the prefix is how rulesync tells its own hooks apart.
 */
export const ZERO_RULESYNC_HOOK_ID_PREFIX = "rulesync-";

/**
 * Canonical (Claude Code) tool names and the Zero tool names that cover them.
 * Zero matches a matcher case-sensitively against its own tool names, which
 * are lowercase snake_case, so `Bash` must become `bash` or a guard on it
 * never runs. A canonical name with several Zero counterparts expands to all
 * of them, so a guard on `Bash` also covers `exec_command` and `write_stdin`
 * (Zero's other default shell tools), one on `Edit` also covers `apply_patch`
 * and one on `Read` also covers `read_minified_file`.
 * @see https://github.com/Twigpine/zero/tree/main/internal/tools
 * @see https://github.com/Twigpine/zero/blob/main/docs/SPECIALISTS.md#tool-selection
 */
const CANONICAL_TO_ZERO_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = {
  Bash: ["bash", "exec_command", "write_stdin"],
  Read: ["read_file", "read_minified_file"],
  Write: ["write_file"],
  Edit: ["edit_file", "apply_patch"],
  MultiEdit: ["edit_file", "apply_patch"],
  Glob: ["glob"],
  Grep: ["grep"],
  LS: ["list_directory"],
  WebFetch: ["web_fetch"],
  WebSearch: ["web_search"],
  Skill: ["skill"],
  AskUserQuestion: ["ask_user"],
};

/** Zero tool names mapped back to the canonical name, for import. */
const ZERO_TO_CANONICAL_TOOL_NAMES: Readonly<Record<string, string>> = {
  bash: "Bash",
  exec_command: "Bash",
  write_stdin: "Bash",
  read_file: "Read",
  read_minified_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  apply_patch: "Edit",
  glob: "Glob",
  grep: "Grep",
  list_directory: "LS",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  skill: "Skill",
  ask_user: "AskUserQuestion",
};

/**
 * Zero's built-in tool names (core, control and specialist tools). A
 * `preToolUse` matcher naming anything else (outside `mcp_*` and globs) is
 * warned about, since such a guard would never run.
 * @see https://github.com/Twigpine/zero/blob/main/internal/tools/builtin_catalog.go
 */
const ZERO_TOOL_NAMES: ReadonlySet<string> = new Set([
  "bash",
  "exec_command",
  "write_stdin",
  "read_file",
  "read_minified_file",
  "view_image",
  "write_file",
  "edit_file",
  "apply_patch",
  "glob",
  "grep",
  "list_directory",
  "lsp_navigate",
  "web_fetch",
  "web_search",
  "skill",
  "ask_user",
  "request_permissions",
  "update_plan",
  "escalate_model",
  "tool_search",
  "Task",
  "TaskOutput",
  "TaskStop",
  "GenerateSpecialist",
]);

const MATCHER_EVENTS: ReadonlySet<string> = new Set(ZERO_MATCHER_EVENTS);
const TOOL_MATCHER_EVENTS: ReadonlySet<string> = new Set(["preToolUse", "postToolUse"]);

/** Zero's MCP tool name part: lowercase, `-` and unsafe characters as `_`. */
function sanitizeMcpNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_*]/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** A `*` glob as an anchored, case-sensitive regex. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Translate one plain matcher alternative (a name or a `*` glob) to the Zero
 * names it stands for, or `undefined` when it names no known tool. A glob is
 * expanded against the canonical names (`Bash*` covers everything `Bash`
 * does). Canonical MCP names (`mcp__<server>__<tool>`) become Zero's
 * `mcp_<server>_<tool>`. A name or glob without capitals is taken as already
 * spelled the Zero way.
 */
function translateToolName(name: string): string[] | undefined {
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const separator = rest.indexOf("__");
    const parts =
      separator < 0 ? [rest] : [rest.slice(0, separator), rest.slice(separator + "__".length)];
    return [`mcp_${parts.map((part) => sanitizeMcpNamePart(part)).join("_")}`];
  }
  if (!name.includes("*")) {
    const mapped = lookupOwn({ record: CANONICAL_TO_ZERO_TOOL_NAMES, key: name });
    if (mapped !== undefined) return [...mapped];
    return /[A-Z]/.test(name) && !ZERO_TOOL_NAMES.has(name) ? undefined : [name];
  }
  const pattern = globToRegExp(name);
  const expanded = Object.entries(CANONICAL_TO_ZERO_TOOL_NAMES)
    .filter(([canonical]) => pattern.test(canonical))
    .flatMap(([, zeroNames]) => zeroNames);
  if (expanded.length > 0) return expanded;
  return /[A-Z]/.test(name) ? undefined : [name];
}

/**
 * Convert a canonical matcher (a regex over the tool name) to Zero matchers.
 * Zero's matcher is an exact name or a `*` glob, case-sensitive, with no
 * alternation, so a `Write|Edit` matcher becomes one Zero hook per name.
 *
 * Returns `undefined` when the hook should run for every tool (no matcher),
 * or the list of Zero matchers. A `preToolUse` guard whose matcher Zero cannot
 * express, or that names no Zero tool through a glob, runs on every tool
 * instead (failing closed, with a warning); on other events such a matcher is
 * written as-is or, when it is not expressible at all, dropped with a warning
 * (`null`).
 */
function canonicalToZeroMatchers({
  matcher,
  event,
  warn,
}: {
  matcher: string | undefined;
  event: string;
  warn: (message: string) => void;
}): string[] | undefined | null {
  const trimmed = matcher?.trim() ?? "";
  if (trimmed === "") return undefined;
  if (!MATCHER_EVENTS.has(event)) {
    warn(
      `matcher ${quoteValueForWarning(trimmed)} on "${event}" hook will be ignored — ` +
        `Zero only accepts a matcher on tool and specialist events.`,
    );
    return undefined;
  }
  const isGuard = event === "preToolUse";
  const failClosed = (reason: string): undefined => {
    warn(
      `The "${event}" matcher ${quoteValueForWarning(trimmed)} ${reason}, so the guard is ` +
        `written without a matcher and runs before every Zero tool call.`,
    );
    return undefined;
  };

  const result: string[] = [];
  for (const alternative of trimmed.split("|")) {
    const plain = alternative.trim().replace(/^\^/, "").replace(/\$$/, "");
    if (plain === "" || plain === ".*" || plain === "*") return undefined;
    const glob = plain.replaceAll(".*", "*");
    if (!/^[A-Za-z0-9_*-]+$/.test(glob)) {
      if (isGuard) {
        return failClosed(
          `uses regex syntax Zero cannot express (Zero matches an exact name or a "*" glob)`,
        );
      }
      warn(
        `The "${event}" matcher ${quoteValueForWarning(trimmed)} uses regex syntax Zero cannot ` +
          `express (Zero matches an exact name or a "*" glob), so the hook was skipped.`,
      );
      return null;
    }
    if (!TOOL_MATCHER_EVENTS.has(event)) {
      result.push(glob);
      continue;
    }
    const names = translateToolName(glob);
    if (names !== undefined) {
      result.push(...names);
      continue;
    }
    if (isGuard && glob.includes("*")) {
      return failClosed(`has ${quoteValueForWarning(glob)}, which matches no Zero tool`);
    }
    warn(
      `${quoteValueForWarning(glob)} in the "${event}" matcher ${quoteValueForWarning(trimmed)} ` +
        `is not a Zero built-in tool, so it is written as-is and will likely never match ` +
        `there, and the hook will not run for that tool.`,
    );
    result.push(glob);
  }
  return [...new Set(result)];
}

/** Convert a Zero matcher back to the canonical regex spelling. */
function zeroToCanonicalMatcher({
  matcher,
  canonicalEvent,
}: {
  matcher: string;
  canonicalEvent: string;
}): string {
  if (matcher === "*") return ".*";
  if (TOOL_MATCHER_EVENTS.has(canonicalEvent) && !matcher.includes("*")) {
    const canonical = lookupOwn({ record: ZERO_TO_CANONICAL_TOOL_NAMES, key: matcher });
    if (canonical !== undefined) return canonical;
  }
  return matcher.replaceAll("*", ".*");
}

/** Quote a word for a POSIX shell command line. */
function quotePosixWord(word: string): string {
  return /^[A-Za-z0-9_/.,:=@%+-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * The shell command line a Zero hook runs. rulesync writes a canonical command
 * as `sh -c <command>`, since Zero passes `command` and `args` to
 * `exec.CommandContext` without a shell.
 */
function zeroCommandLine(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.command !== "string" || entry.command.trim() === "") return undefined;
  const args = isStringArray(entry.args) ? entry.args : [];
  if (entry.command === "sh" && args.length === 2 && args[0] === "-c") {
    return args[1];
  }
  return [entry.command, ...args].map((word) => quotePosixWord(word)).join(" ");
}

/**
 * What a Zero hook does, for spotting a generated entry that repeats a
 * hand-written one: its event, matcher, shell command line and enabled flag.
 */
function zeroEntryIdentity(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  const matcher = typeof entry.matcher === "string" ? entry.matcher.trim() : "";
  return JSON.stringify([entry.event, matcher, zeroCommandLine(entry), entry.enabled !== false]);
}

/**
 * Build Zero hook entries from the canonical config (the `zero.hooks`
 * override block replaces the shared hooks of the same event).
 */
function canonicalToZeroEntries({
  config,
  scope,
  logger,
}: {
  config: HooksConfig;
  scope: "project" | "user";
  logger?: Logger;
}): ZeroHookEntry[] {
  const warn = warnOnce(logger);
  const effective: HooksConfig["hooks"] = { ...config.hooks, ...config.zero?.hooks };
  const supported: ReadonlySet<string> = new Set(ZERO_HOOK_EVENTS);
  const entries: ZeroHookEntry[] = [];

  for (const [event, defs] of Object.entries(effective)) {
    if (isPrototypePollutionKey(event) || !supported.has(event) || !Array.isArray(defs)) continue;
    const zeroEvent = lookupOwn({ record: CANONICAL_TO_ZERO_EVENT_NAMES, key: event });
    if (zeroEvent === undefined) continue;

    let counter = 0;
    for (const def of defs) {
      if ((def.type ?? "command") !== "command") continue;
      if (typeof def.command !== "string" || def.command.trim() === "") {
        warn(
          `Zero hook ${quoteValueForWarning(def.name ?? "")} under "${event}" has no "command", so it was skipped.`,
        );
        continue;
      }
      if (def.timeout !== undefined) {
        warn(
          `Zero hooks have no per-hook timeout, so "timeout" on "${event}" hooks is ignored ` +
            `(Zero applies its own default and blocks a timed-out beforeTool hook).`,
        );
      }
      const matchers = canonicalToZeroMatchers({ matcher: def.matcher, event, warn });
      if (matchers === null) continue;

      for (const matcher of matchers ?? [undefined]) {
        counter += 1;
        entries.push({
          id: `${ZERO_RULESYNC_HOOK_ID_PREFIX}${scope}-${zeroEvent}-${String(counter).padStart(3, "0")}`,
          ...(typeof def.name === "string" && def.name.trim() !== "" && { name: def.name }),
          event: zeroEvent,
          ...(matcher !== undefined && { matcher }),
          command: "sh",
          args: ["-c", def.command],
          enabled: def.enabled !== false,
        });
      }
    }
  }
  return entries;
}

/** One Zero entry read back as a canonical event and definition. */
function zeroEntryToCanonical(
  raw: unknown,
): { event: string; def: HookDefinition; key: string } | undefined {
  if (!isRecord(raw) || typeof raw.event !== "string") return undefined;
  const command = zeroCommandLine(raw);
  if (command === undefined) return undefined;
  const event = lookupOwn({ record: ZERO_TO_CANONICAL_EVENT_NAMES, key: raw.event }) ?? raw.event;
  if (isPrototypePollutionKey(event)) return undefined;
  const def: HookDefinition = { type: "command", command };
  if (typeof raw.matcher === "string" && raw.matcher.trim() !== "") {
    def.matcher = zeroToCanonicalMatcher({ matcher: raw.matcher.trim(), canonicalEvent: event });
  }
  if (typeof raw.name === "string" && raw.name !== "") def.name = raw.name;
  if (raw.enabled === false) def.enabled = false;
  return { event, def, key: JSON.stringify([command, def.name, def.enabled]) };
}

/**
 * Read Zero entries back into a canonical event -> definitions record.
 * Adjacent entries that share an event, command, name and enabled flag are
 * folded back into one hook with an alternation matcher, undoing the
 * one-hook-per-name split generation performs.
 */
function zeroEntriesToCanonical(rawEntries: unknown[]): HooksConfig["hooks"] {
  const hooks: HooksConfig["hooks"] = {};
  let previous: { event: string; key: string; def: HookDefinition } | undefined;
  for (const raw of rawEntries) {
    const entry = zeroEntryToCanonical(raw);
    if (entry === undefined) continue;
    const { event, def, key } = entry;
    if (
      previous?.def.matcher !== undefined &&
      def.matcher !== undefined &&
      previous.event === event &&
      previous.key === key
    ) {
      const names = new Set(previous.def.matcher.split("|"));
      names.add(def.matcher);
      previous.def.matcher = [...names].join("|");
      continue;
    }
    const list = lookupOwn({ record: hooks, key: event }) ?? [];
    hooks[event] = [...list, def];
    previous = entry;
  }
  return hooks;
}

/**
 * Parse Zero's `hooks.json`, refusing content that is not a JSON object, so a
 * file rulesync could not read is never overwritten.
 */
function parseZeroHooksFile({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}): Record<string, unknown> {
  if (content.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse Zero hooks file ${filePath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new Error(`Zero hooks file ${filePath} is not a JSON object, so it was not rewritten.`);
  }
  return parsed;
}

function isRulesyncEntry(entry: unknown): boolean {
  return (
    isRecord(entry) &&
    typeof entry.id === "string" &&
    entry.id.startsWith(ZERO_RULESYNC_HOOK_ID_PREFIX)
  );
}

/**
 * Zero hooks.
 *
 * Zero reads `{ enabled, hooks: [{ id, event, matcher, command, args, enabled }] }`
 * from `.zero/hooks.json` (project) and `<user config dir>/zero/hooks.json`
 * (`~/.config/zero/hooks.json` on Linux and macOS, `%AppData%\zero\hooks.json`
 * on Windows). Events map as `preToolUse` -> `beforeTool`, `postToolUse` ->
 * `afterTool`, `sessionStart`, `sessionEnd`, `subagentStart` ->
 * `specialistStart` and `subagentStop` -> `specialistStop`.
 *
 * - `command` and `args` are run without a shell, so a canonical command is
 *   written as `command: "sh", args: ["-c", <command>]`. The hook payload is
 *   Zero's own JSON on stdin (`event`, `tool`, `args`, ...), not Claude Code's.
 * - A matcher is an exact tool name or a `*` glob against Zero's lowercase
 *   tool names, so canonical names are translated (`Bash` -> `bash`,
 *   `exec_command`, `write_stdin`) and an alternation becomes one hook per
 *   name. A `preToolUse` guard Zero cannot scope fails closed (no matcher).
 * - Hook ids are `rulesync-<project|user>-<event>-<n>`: Zero merges the user
 *   and project layers by id (the project wins), so the scope keeps the two
 *   layers apart, and the zero-padded counter keeps Zero's id-sorted run order
 *   equal to the authored order.
 * - `zero hooks` edits the same file, so generation keeps every entry whose id
 *   does not start with `rulesync-` and skips generating an entry identical to
 *   one of them (as an import followed by a generate would otherwise do). The
 *   top-level `enabled` flag is kept as found and never added, and the file is
 *   never deleted.
 *
 * @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md#4-hooks
 * @see https://github.com/Twigpine/zero/blob/main/internal/hooks/hooks.go
 */
export class ZeroHooks extends ToolHooks {
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: global ? zeroGlobalConfigDir() : ZERO_DIR,
      relativeFilePath: ZERO_HOOKS_FILE_NAME,
    };
  }

  protected static override getMissingFileContent(): string {
    return '{"hooks":[]}';
  }

  protected static override getDeletionFileContent(): string {
    return JSON.stringify({ hooks: [] }, null, 2);
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
  }): Promise<ZeroHooks> {
    const paths = ZeroHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existing = parseZeroHooksFile({
      content: (await readFileContentOrNull(filePath)) ?? "",
      filePath,
    });
    const kept = Array.isArray(existing.hooks)
      ? existing.hooks.filter((entry) => !isRulesyncEntry(entry))
      : [];
    // A hand-written entry that an import brought into the rulesync source
    // comes back here as a generated one; it is not written twice.
    const keptKeys = new Set(kept.map((entry) => zeroEntryIdentity(entry)));
    const generated = canonicalToZeroEntries({
      config: rulesyncHooks.getJson(),
      scope: global ? "user" : "project",
      logger,
    }).filter((entry) => !keptKeys.has(zeroEntryIdentity(entry)));

    // The top-level `enabled` is only written when the file already states
    // it: Zero lets a layer that states it override the other layer, so an
    // added `enabled: true` would switch on hooks the user layer turned off.
    const fileContent = JSON.stringify({ ...existing, hooks: [...kept, ...generated] }, null, 2);

    return new ZeroHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const parsed = this.parseFileContentOrThrow({
      displayName: "Zero",
      parse: (fileContent) =>
        parseZeroHooksFile({
          content: fileContent,
          filePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
        }),
    });
    const hooks = zeroEntriesToCanonical(Array.isArray(parsed.hooks) ? parsed.hooks : []);

    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ logger, hooks, overrideKey: "zero" }),
        null,
        2,
      ),
    });
  }
}
