import { join } from "node:path";

import * as smolToml from "smol-toml";

import {
  CODEWHALE_CONFIG_FILE_NAME,
  CODEWHALE_DIR,
  CODEWHALE_HOOKS_FILE_NAME,
} from "../../constants/codewhale-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_CODEWHALE_EVENT_NAMES,
  CODEWHALE_HOOK_EVENTS,
  CODEWHALE_MATCHER_HOOK_EVENTS,
  CODEWHALE_TO_CANONICAL_EVENT_NAMES,
  type HookDefinition,
  type HooksConfig,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import {
  isPrototypePollutionKey,
  omitPrototypePollutionKeysDeep,
} from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  CODEWHALE_CONFIG_SHARED_FILE_KEY,
  parseSharedConfig,
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

type CodewhaleCondition = Record<string, unknown>;

/**
 * One serialized hook entry.
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/hooks/config.rs
 */
type CodewhaleHookEntry = {
  event: string;
  command: string;
  name?: string;
  condition?: CodewhaleCondition;
  timeout_secs?: number;
  background?: boolean;
  continue_on_error?: boolean;
};

const SUPPORTED_EVENTS: ReadonlySet<string> = new Set(CODEWHALE_HOOK_EVENTS);
const MATCHER_EVENTS: ReadonlySet<string> = new Set(CODEWHALE_MATCHER_HOOK_EVENTS);

/**
 * A matcher Codewhale can express: `|`-separated tool names, each of which may
 * use the `*` glob that `tool_name` conditions support. Anything else (regex
 * syntax such as `.`, `(`, `[`) has no `tool_name` equivalent.
 */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_*-]+$/;

/**
 * Translate a canonical tool-name matcher into a Codewhale condition.
 * Returns `null` when the matcher cannot be expressed, `undefined` when it
 * matches every tool (no condition needed).
 */
function matcherToCondition(matcher: string): CodewhaleCondition | undefined | null {
  const trimmed = matcher.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === ".*") {
    return undefined;
  }
  const names = trimmed.split("|").map((name) => name.trim());
  if (!names.every((name) => TOOL_NAME_PATTERN.test(name))) {
    return null;
  }
  const conditions = names.map((name) => ({ type: "tool_name", name }));
  return conditions.length === 1 ? conditions[0] : { type: "any", conditions };
}

/** Reverse {@link matcherToCondition}; `undefined` when not a tool-name condition. */
function conditionToMatcher(condition: Record<string, unknown>): string | undefined {
  if (condition.type === "tool_name" && typeof condition.name === "string") {
    return condition.name;
  }
  if (condition.type === "any" && Array.isArray(condition.conditions)) {
    const names: string[] = [];
    for (const inner of condition.conditions) {
      if (!isPlainObject(inner) || inner.type !== "tool_name" || typeof inner.name !== "string") {
        return undefined;
      }
      names.push(inner.name);
    }
    return names.length > 0 ? names.join("|") : undefined;
  }
  return undefined;
}

/**
 * Convert one canonical command hook into a Codewhale entry, or `null` when
 * its matcher cannot be expressed as a Codewhale condition.
 */
function buildCodewhaleEntry({
  event,
  codewhaleEvent,
  def,
  command,
  logger,
}: {
  event: string;
  codewhaleEvent: string;
  def: HookDefinition;
  command: string;
  logger?: Logger;
}): CodewhaleHookEntry | null {
  const loose = def as Record<string, unknown>;
  let matcherCondition: CodewhaleCondition | undefined;
  if (MATCHER_EVENTS.has(event) && typeof def.matcher === "string") {
    const converted = matcherToCondition(def.matcher);
    if (converted === null) {
      // Dropping only the condition would widen the hook to every tool,
      // which for a `tool_call_before` gate is the opposite of intended.
      logger?.warn(
        `skipping a "${event}" hook: matcher ${quoteValueForWarning(def.matcher)} is not a ` +
          `"|"-separated list of tool names (with optional "*" globs), which is all a ` +
          `Codewhale tool_name condition can express.`,
      );
      return null;
    }
    matcherCondition = converted;
  }
  const rawCondition = isPlainObject(loose.condition)
    ? (omitPrototypePollutionKeysDeep(loose.condition) as CodewhaleCondition)
    : undefined;
  const condition =
    matcherCondition && rawCondition
      ? { type: "all", conditions: [matcherCondition, rawCondition] }
      : (matcherCondition ?? rawCondition);

  const entry: CodewhaleHookEntry = { event: codewhaleEvent, command };
  if (typeof def.name === "string") {
    entry.name = def.name;
  }
  if (condition) {
    entry.condition = condition;
  }
  if (def.timeout !== undefined) {
    if (Number.isInteger(def.timeout) && def.timeout > 0) {
      entry.timeout_secs = def.timeout;
    } else {
      logger?.warn(
        `omitting the timeout of a "${event}" hook: Codewhale expects a positive whole number of seconds.`,
      );
    }
  }
  if (typeof loose.background === "boolean") {
    entry.background = loose.background;
  }
  if (typeof loose.continue_on_error === "boolean") {
    entry.continue_on_error = loose.continue_on_error;
  }
  return entry;
}

/**
 * Build the hook entries for a canonical hooks config. Only `command` hooks
 * are emitted; Codewhale runs `command` through the platform shell.
 */
function canonicalToCodewhaleHooks({
  config,
  logger,
}: {
  config: HooksConfig;
  logger?: Logger;
}): CodewhaleHookEntry[] {
  const shared: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (SUPPORTED_EVENTS.has(event)) {
      shared[event] = defs;
    }
  }
  const effective: HooksConfig["hooks"] = { ...shared, ...config.codewhale?.hooks };

  const entries: CodewhaleHookEntry[] = [];
  for (const [event, defs] of Object.entries(effective)) {
    if (!SUPPORTED_EVENTS.has(event)) {
      continue;
    }
    const codewhaleEvent = lookupOwn({ record: CANONICAL_TO_CODEWHALE_EVENT_NAMES, key: event });
    if (codewhaleEvent === undefined) {
      continue;
    }
    for (const def of defs) {
      if ((def.type ?? "command") !== "command" || typeof def.command !== "string") {
        continue;
      }
      const entry = buildCodewhaleEntry({
        event,
        codewhaleEvent,
        def,
        command: def.command,
        logger,
      });
      if (entry) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

/** Reverse {@link canonicalToCodewhaleHooks} for a raw hook entry array. */
function codewhaleHooksToCanonical(rawHooks: unknown): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  if (!Array.isArray(rawHooks)) {
    return canonical;
  }
  for (const raw of rawHooks) {
    if (!isPlainObject(raw)) {
      continue;
    }
    if (typeof raw.event !== "string" || typeof raw.command !== "string") {
      continue;
    }
    // The raw name becomes a key of the canonical record when it has no
    // canonical counterpart, so a prototype-pollution key is skipped outright.
    if (isPrototypePollutionKey(raw.event)) {
      continue;
    }
    const event =
      lookupOwn({ record: CODEWHALE_TO_CANONICAL_EVENT_NAMES, key: raw.event }) ?? raw.event;
    const def: HookDefinition = { type: "command", command: raw.command };
    if (typeof raw.name === "string") {
      def.name = raw.name;
    }
    if (isPlainObject(raw.condition) && raw.condition.type !== "always") {
      const matcher = conditionToMatcher(raw.condition);
      if (matcher !== undefined) {
        def.matcher = matcher;
      } else {
        (def as Record<string, unknown>).condition = omitPrototypePollutionKeysDeep(raw.condition);
      }
    }
    if (typeof raw.timeout_secs === "number") {
      def.timeout = raw.timeout_secs;
    }
    if (typeof raw.background === "boolean") {
      (def as Record<string, unknown>).background = raw.background;
    }
    if (typeof raw.continue_on_error === "boolean") {
      (def as Record<string, unknown>).continue_on_error = raw.continue_on_error;
    }
    const list = lookupOwn({ record: canonical, key: event }) ?? [];
    list.push(def);
    canonical[event] = list;
  }
  return canonical;
}

function parseCodewhaleToml(fileContent: string): Record<string, unknown> {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  return isPlainObject(parsed) ? { ...parsed } : {};
}

/**
 * Codewhale hooks adapter.
 *
 * Project scope writes `.codewhale/hooks.toml`, whose top-level `[[hooks]]`
 * entries Codewhale appends after the user's hooks — once the workspace is
 * trusted and the exact file bytes are approved with `/hooks approve`, so a
 * regenerated file needs approving again. The file is rulesync-owned.
 *
 * Global scope writes the `[hooks]` table of `~/.codewhale/config.toml`
 * (entries under `[[hooks.hooks]]`). That file carries every other Codewhale
 * setting, so the hook list is merged in place, the table's own settings
 * (`enabled`, `default_timeout_secs`, `working_dir`) are kept, and the file is
 * never deleted.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/HOOKS.md
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/hooks/config.rs
 */
export class CodewhaleHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? smolToml.stringify({}),
    });
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: CODEWHALE_DIR,
      relativeFilePath: global ? CODEWHALE_CONFIG_FILE_NAME : CODEWHALE_HOOKS_FILE_NAME,
    };
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  override shouldMergeExistingFileContent(): boolean {
    return this.global;
  }

  override setFileContent(fileContent: string): void {
    if (!this.global) {
      this.fileContent = fileContent;
      return;
    }
    const paths = CodewhaleHooks.getSettablePaths({ global: true });
    const filePath = join(paths.relativeDirPath, paths.relativeFilePath);
    const existing = parseSharedConfig({
      format: "toml",
      fileContent,
      filePath,
      invalidRootPolicy: "error",
    });
    const generated = parseSharedConfig({ format: "toml", fileContent: this.fileContent });
    const generatedTable = isPlainObject(generated.hooks) ? generated.hooks : {};
    // Keep the `[hooks]` table's own settings; only its entry list is ours.
    const existingTable = isPlainObject(existing.hooks) ? existing.hooks : {};
    const { hooks: _existingEntries, ...tableSettings } = existingTable;
    this.fileContent = applySharedConfigPatch({
      fileKey: CODEWHALE_CONFIG_SHARED_FILE_KEY,
      feature: "hooks",
      existingContent: fileContent,
      patch: { hooks: { ...tableSettings, hooks: generatedTable.hooks ?? [] } },
      filePath,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CodewhaleHooks> {
    const paths = CodewhaleHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    return new CodewhaleHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<CodewhaleHooks> {
    const paths = CodewhaleHooks.getSettablePaths({ global });
    const hooks = canonicalToCodewhaleHooks({ config: rulesyncHooks.getJson(), logger });
    const fileContent = smolToml.stringify(global ? { hooks: { hooks } } : { hooks });

    return new CodewhaleHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseCodewhaleToml(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Codewhale hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const rawHooks = this.global
      ? isPlainObject(parsed.hooks)
        ? parsed.hooks.hooks
        : undefined
      : parsed.hooks;
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({
          hooks: codewhaleHooksToCanonical(rawHooks),
          overrideKey: "codewhale",
        }),
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    try {
      parseCodewhaleToml(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Codewhale hooks TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolHooksForDeletionParams): CodewhaleHooks {
    return new CodewhaleHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
      global,
    });
  }
}
