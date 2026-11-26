import { join } from "node:path";

import * as smolToml from "smol-toml";

import { JCODE_CONFIG_FILE_NAME, JCODE_DIR } from "../../constants/jcode-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_JCODE_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
  JCODE_HOOK_EVENTS,
  JCODE_NATIVE_ONLY_HOOK_EVENTS,
  JCODE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/** One `[hooks]` command value: a command string or a list of them. */
type JcodeHookValue = string | string[];

const SUPPORTED_EVENTS: ReadonlySet<string> = new Set(JCODE_HOOK_EVENTS);
const NATIVE_ONLY_EVENTS: ReadonlySet<string> = new Set(JCODE_NATIVE_ONLY_HOOK_EVENTS);

/**
 * The `[hooks]` keys the six mapped canonical events write to. rulesync never
 * removes one of them: without an ownership record it cannot tell its own
 * value from a hand-written one, and silently dropping a hand-written
 * `pre_tool` gate would make it fail open. A key is replaced only when this run
 * generates a value for it (with a warning when that changes the file), and
 * every other key of the table is kept as it is.
 */
const MAPPED_EVENT_KEYS: ReadonlySet<string> = new Set(
  Object.values(CANONICAL_TO_JCODE_EVENT_NAMES),
);

/** Native jcode `[hooks]` keys that hold commands (as opposed to settings). */
const COMMAND_KEYS: ReadonlySet<string> = new Set([...MAPPED_EVENT_KEYS, ...NATIVE_ONLY_EVENTS]);

/** A matcher that selects everything, so dropping it changes nothing. */
const MATCH_ALL_MATCHERS: ReadonlySet<string> = new Set(["", "*", ".*"]);

/**
 * Shell syntax jcode will not interpret: it splits a hook command shell-style
 * (quotes and backslash escapes) but executes it directly, without a shell.
 */
const SHELL_SYNTAX = /[|&;<>`$]/;

/**
 * Build the command list for one jcode key from canonical definitions,
 * warning about everything jcode cannot express.
 *
 * jcode hooks carry no matcher: every hook runs for every tool call (or every
 * occurrence of its lifecycle event). A matcher is therefore never a reason to
 * drop a hook — for the `pre_tool` gate that would silently remove a guard —
 * so the hook is widened to every tool, with a warning.
 */
function definitionsToCommands({
  sourceEvent,
  nativeEvent,
  definitions,
  logger,
}: {
  sourceEvent: string;
  nativeEvent: string;
  definitions: HookDefinition[];
  logger?: Logger;
}): string[] {
  const commands: string[] = [];
  for (const def of definitions) {
    if ((def.type ?? "command") !== "command" || typeof def.command !== "string") {
      // Non-command hook types are reported centrally by the processor.
      continue;
    }
    if (def.command.trim() === "") {
      continue;
    }
    if (typeof def.matcher === "string" && !MATCH_ALL_MATCHERS.has(def.matcher.trim())) {
      logger?.warn(
        nativeEvent === "pre_tool" || nativeEvent === "post_tool"
          ? `jcode hooks have no matcher: the "${sourceEvent}" hook with matcher ${quoteValueForWarning(def.matcher)} is written to "${nativeEvent}" and runs for every tool call, so whatever it does — blocking a call, or rewriting the input through "updatedInput" — applies to every tool. jcode passes the tool name in JCODE_HOOK_TOOL_NAME, so filter on it inside the hook.`
          : `jcode hooks have no matcher: matcher ${quoteValueForWarning(def.matcher)} on the "${sourceEvent}" hook is ignored and the hook runs on every "${nativeEvent}" event.`,
      );
    }
    if (def.timeout !== undefined) {
      logger?.warn(
        `jcode has no per-hook timeout: the timeout of the "${sourceEvent}" hook is dropped (only "pre_tool_timeout_ms", "post_tool_feedback_timeout_ms" and "pre_tool_transform_timeout_ms" exist, set them in the [hooks] table by hand).`,
      );
    }
    if (def.failClosed === true) {
      logger?.warn(
        `jcode hooks always fail open: failClosed on the "${sourceEvent}" hook is ignored (a crash, timeout or exit code other than 0/2 lets the call through).`,
      );
    }
    if (SHELL_SYNTAX.test(def.command)) {
      logger?.warn(
        `jcode runs hook commands directly, not through a shell: the "${sourceEvent}" hook command ${quoteValueForWarning(def.command)} uses shell syntax that will not be interpreted. Wrap it in a script, or in "sh -c '...'".`,
      );
    }
    commands.push(def.command);
  }
  return commands;
}

/** Collapse a command list into jcode's string-or-list value. */
function toJcodeValue(commands: string[]): JcodeHookValue | undefined {
  if (commands.length === 0) return undefined;
  return commands.length === 1 ? commands[0] : commands;
}

/**
 * Convert the canonical hooks config into jcode's `[hooks]` command keys.
 */
function canonicalToJcodeHooks({
  config,
  logger,
}: {
  config: HooksConfig;
  logger?: Logger;
}): Record<string, JcodeHookValue> {
  const shared: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (SUPPORTED_EVENTS.has(event)) {
      shared[event] = defs;
    }
  }
  const effective: HooksConfig["hooks"] = { ...shared, ...config.jcode?.hooks };

  // Several canonical events never share a jcode key, but a native-only key and
  // its definitions are kept apart from the mapped ones all the same.
  const result: Record<string, JcodeHookValue> = {};
  for (const [event, defs] of Object.entries(effective)) {
    if (isPrototypePollutionKey(event)) continue;
    const nativeEvent = NATIVE_ONLY_EVENTS.has(event)
      ? event
      : SUPPORTED_EVENTS.has(event)
        ? lookupOwn({ record: CANONICAL_TO_JCODE_EVENT_NAMES, key: event })
        : undefined;
    if (nativeEvent === undefined) {
      // Shared keys are filtered above, so this one came from the override
      // block, whose unknown keys the processor reports.
      continue;
    }
    const value = toJcodeValue(
      definitionsToCommands({ sourceEvent: event, nativeEvent, definitions: defs, logger }),
    );
    if (value !== undefined) {
      result[nativeEvent] = value;
    }
  }
  return result;
}

/** Read one `[hooks]` command value back into a list of commands. */
function readJcodeCommands(value: unknown): string[] {
  const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return list.filter(
    (command): command is string => typeof command === "string" && command.trim() !== "",
  );
}

/** Reverse {@link canonicalToJcodeHooks} for a raw `[hooks]` table. */
function jcodeHooksToCanonical(table: unknown): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  if (!isPlainObject(table)) {
    return canonical;
  }
  for (const [key, value] of Object.entries(table)) {
    if (!COMMAND_KEYS.has(key)) continue;
    const event = lookupOwn({ record: JCODE_TO_CANONICAL_EVENT_NAMES, key }) ?? key;
    const defs: HookDefinition[] = readJcodeCommands(value).map((command) => ({
      type: "command",
      command,
    }));
    if (defs.length > 0) {
      canonical[event] = defs;
    }
  }
  return canonical;
}

/** Whether two `[hooks]` values run the same commands, string and list forms alike. */
function sameCommands(a: unknown, b: unknown): boolean {
  return JSON.stringify(readJcodeCommands(a)) === JSON.stringify(readJcodeCommands(b));
}

function parseJcodeToml(fileContent: string): Record<string, unknown> {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  return isPlainObject(parsed) ? { ...parsed } : {};
}

/**
 * jcode lifecycle hooks.
 *
 * jcode reads hooks only from the `[hooks]` table of the user config
 * `~/.jcode/config.toml` (there is no project-scoped hooks file), so this
 * adapter is global-only. Each key is one lifecycle point and takes a command
 * string or a list of them; rulesync writes a string for a single hook and a
 * list for several. The file also holds every other jcode setting, so only the
 * `[hooks]` table is touched, and within it only the command keys this run
 * generates (see {@link MAPPED_EVENT_KEYS}); the file is never deleted.
 *
 * @see https://github.com/1jehuang/jcode/blob/master/docs/HOOKS.md
 */
export class JcodeHooks extends ToolHooks {
  /** Set by {@link fromRulesyncHooks}, so the merge can report what it overwrites. */
  private mergeLogger: Logger | undefined;

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Global only; the processor supplies the home directory as outputRoot.
    return { relativeDirPath: JCODE_DIR, relativeFilePath: JCODE_CONFIG_FILE_NAME };
  }

  override isDeletable(): boolean {
    return false;
  }

  override shouldMergeExistingFileContent(): boolean {
    return true;
  }

  override setFileContent(fileContent: string): void {
    const paths = JcodeHooks.getSettablePaths();
    const filePath = join(paths.relativeDirPath, paths.relativeFilePath);
    const fileKey = sharedConfigFileKey(paths);
    const existing = parseSharedConfig({
      format: "toml",
      fileContent,
      filePath,
      invalidRootPolicy: "error",
    });
    const generated = parseSharedConfig({ format: "toml", fileContent: this.fileContent });
    const generatedTable = isPlainObject(generated.hooks) ? generated.hooks : {};
    const existingTable = isPlainObject(existing.hooks) ? existing.hooks : {};

    // Only the keys this run generates are replaced; every other key — table
    // settings, and command keys rulesync does not generate this time, which
    // may be hand-written gates — is kept as it is.
    const preserved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(existingTable)) {
      if (key in generatedTable) {
        if (!sameCommands(value, generatedTable[key])) {
          this.mergeLogger?.warn(
            `Overwriting the existing jcode [hooks] key "${key}" in ${filePath} (was ${quoteValueForWarning(value)}). Import it first to keep it.`,
          );
        }
        continue;
      }
      preserved[key] = value;
    }
    const table = { ...preserved, ...generatedTable };
    this.fileContent = applySharedConfigPatch({
      fileKey,
      feature: "hooks",
      existingContent: fileContent,
      patch: { hooks: Object.keys(table).length > 0 ? table : undefined },
      filePath,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<JcodeHooks> {
    const paths = JcodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    return new JcodeHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<JcodeHooks> {
    const paths = JcodeHooks.getSettablePaths({ global });
    const hooks = canonicalToJcodeHooks({ config: rulesyncHooks.getJson(), logger });
    const fileContent = smolToml.stringify(Object.keys(hooks).length > 0 ? { hooks } : {});
    const jcodeHooks = new JcodeHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
    jcodeHooks.mergeLogger = logger;
    return jcodeHooks;
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const parsed: Record<string, unknown> = this.parseFileContentOrThrow({
      displayName: "jcode",
      parse: (fileContent) => parseJcodeToml(fileContent),
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({
          logger,
          hooks: jcodeHooksToCanonical(parsed.hooks),
          overrideKey: "jcode",
        }),
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    try {
      parseJcodeToml(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse jcode config TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolHooksForDeletionParams): JcodeHooks {
    return new JcodeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
      global,
    });
  }
}
