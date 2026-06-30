import { join } from "node:path";

import { z } from "zod/mini";

import { QWENCODE_DIR, QWENCODE_SETTINGS_FILE_NAME } from "../../constants/qwencode-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  QWENCODE_HOOK_EVENTS,
  QWENCODE_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_QWENCODE_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Drop entries whose value is `undefined` or `null`, keeping the rest as-is.
 * Used to assemble Qwen Code hook objects without listing a conditional spread
 * for every optional field (which would blow past the lint complexity budget).
 */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

/**
 * Build a single Qwen Code hook object from a canonical hook definition.
 * Command-only fields (`async`/`env`/`shell`) are emitted only on command hooks
 * and http-only fields (`headers`/`allowedEnvVars`/`once`) only on http hooks,
 * matching upstream. `statusMessage` applies to both.
 * https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md
 */
function canonicalDefToQwencodeHook(
  def: HooksConfig["hooks"][string][number],
): Record<string, unknown> {
  const type = def.type ?? "command";
  const isHttp = type === "http";
  return {
    type,
    ...compact({
      command: def.command,
      url: def.url,
      timeout: def.timeout,
      name: def.name,
      description: def.description,
      statusMessage: def.statusMessage,
      // Command-only per-hook fields (Qwen Code PR #2827).
      async: isHttp ? undefined : def.async,
      env: isHttp ? undefined : def.env,
      shell: isHttp ? undefined : def.shell,
      // Http-only per-hook fields (Qwen Code PR #2827).
      headers: isHttp ? def.headers : undefined,
      allowedEnvVars: isHttp ? def.allowedEnvVars : undefined,
      once: isHttp ? def.once : undefined,
    }),
  };
}

/**
 * Convert canonical hooks config to Qwen Code format.
 * Filters shared hooks to QWENCODE_HOOK_EVENTS, merges config.qwencode?.hooks,
 * then converts to PascalCase and Qwen Code matcher/hooks structure.
 *
 * Qwen Code does not document a `$GEMINI_PROJECT_DIR`-style variable, so commands
 * are passed through verbatim without any prefixing.
 */
function canonicalToQwencodeHooks(config: HooksConfig): Record<string, unknown[]> {
  const qwencodeSupported: Set<string> = new Set(QWENCODE_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (qwencodeSupported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    ...config.qwencode?.hooks,
  };
  const qwencode: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const qwencodeEventName = CANONICAL_TO_QWENCODE_EVENT_NAMES[eventName] ?? eventName;
    const byMatcher = new Map<string, HooksConfig["hooks"][string]>();
    for (const def of definitions) {
      const key = def.matcher ?? "";
      const list = byMatcher.get(key);
      if (list) list.push(def);
      else byMatcher.set(key, [def]);
    }
    const entries: unknown[] = [];
    for (const [matcherKey, defs] of byMatcher) {
      const hooks = defs.map(canonicalDefToQwencodeHook);
      // A matcher group runs sequentially when any of its definitions opt in.
      // Qwen Code defaults to parallel execution, so only emit when true.
      const sequential = defs.some((def) => def.sequential === true);
      const group: Record<string, unknown> = matcherKey
        ? { matcher: matcherKey, hooks }
        : { hooks };
      if (sequential) {
        group.sequential = true;
      }
      entries.push(group);
    }
    qwencode[qwencodeEventName] = entries;
  }
  return qwencode;
}

/**
 * Qwen Code hook entry as stored in each matcher group's `hooks` array.
 * Uses `z.looseObject` so that unknown fields added by future Qwen Code
 * versions are accepted and silently ignored during import.
 */
const QwencodeHookEntrySchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  // Target URL for `http` hooks (the hook POSTs JSON to this URL).
  url: z.optional(z.string()),
  timeout: z.optional(z.number()),
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  // Progress text shown while the hook runs (command and http hooks).
  statusMessage: z.optional(z.string()),
  // Command-hook fields (Qwen Code PR #2827): background execution, extra
  // subprocess env vars, and shell interpreter selection.
  async: z.optional(z.boolean()),
  env: z.optional(z.record(z.string(), z.string())),
  shell: z.optional(z.string()),
  // Http-hook fields (Qwen Code PR #2827): request headers, env-var allowlist
  // for `${VAR}` interpolation, and once-per-session execution.
  headers: z.optional(z.record(z.string(), z.string())),
  allowedEnvVars: z.optional(z.array(z.string())),
  once: z.optional(z.boolean()),
});

/**
 * A matcher group entry in a Qwen Code event array.
 * Each event maps to an array of these groups. The `sequential` flag (parallel
 * by default) makes the group's hooks run one after another.
 */
const QwencodeMatcherEntrySchema = z.looseObject({
  matcher: z.optional(z.string()),
  hooks: z.optional(z.array(QwencodeHookEntrySchema)),
  sequential: z.optional(z.boolean()),
});

/**
 * Convert a single parsed Qwen Code matcher group into canonical hook definitions.
 */
function qwencodeMatcherEntryToCanonical(
  entry: z.infer<typeof QwencodeMatcherEntrySchema>,
): HooksConfig["hooks"][string] {
  const defs: HooksConfig["hooks"][string] = [];
  const hooks = entry.hooks ?? [];
  const sequential = entry.sequential === true;
  const matcher =
    entry.matcher !== undefined && entry.matcher !== null && entry.matcher !== ""
      ? entry.matcher
      : undefined;
  for (const h of hooks) {
    // Preserve the `http` transport (and its target URL) instead of
    // collapsing every non-prompt hook to `command`.
    const hookType =
      h.type === "command" || h.type === "prompt" || h.type === "http" ? h.type : "command";
    const isHttp = hookType === "http";
    defs.push({
      type: hookType,
      ...compact({
        command: h.command,
        url: h.url,
        timeout: h.timeout,
        name: h.name,
        description: h.description,
        // `statusMessage` applies to both command and http hooks.
        statusMessage: h.statusMessage,
        // Command-only per-hook fields (Qwen Code PR #2827).
        async: isHttp ? undefined : h.async,
        env: isHttp ? undefined : h.env,
        shell: isHttp ? undefined : h.shell,
        // Http-only per-hook fields (Qwen Code PR #2827).
        headers: isHttp ? h.headers : undefined,
        allowedEnvVars: isHttp ? h.allowedEnvVars : undefined,
        once: isHttp ? h.once : undefined,
        sequential: sequential ? true : undefined,
        matcher,
      }),
    });
  }
  return defs;
}

/**
 * Extract hooks from Qwen Code settings.json into canonical format.
 */
function qwencodeHooksToCanonical(qwencodeHooks: unknown): HooksConfig["hooks"] {
  if (qwencodeHooks === null || qwencodeHooks === undefined || typeof qwencodeHooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [qwencodeEventName, matcherEntries] of Object.entries(qwencodeHooks)) {
    const eventName = QWENCODE_TO_CANONICAL_EVENT_NAMES[qwencodeEventName] ?? qwencodeEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HooksConfig["hooks"][string] = [];
    for (const rawEntry of matcherEntries) {
      const parseResult = QwencodeMatcherEntrySchema.safeParse(rawEntry);
      if (!parseResult.success) continue;
      defs.push(...qwencodeMatcherEntryToCanonical(parseResult.data));
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}

export class QwencodeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return { relativeDirPath: QWENCODE_DIR, relativeFilePath: QWENCODE_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<QwencodeHooks> {
    const paths = QwencodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new QwencodeHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<QwencodeHooks> {
    const paths = QwencodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Qwen Code settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const qwencodeHooks = canonicalToQwencodeHooks(config);
    const merged: Record<string, unknown> = { ...settings, hooks: qwencodeHooks };
    // Round-trip Qwen Code's top-level switch that disables every hook.
    const disableAllHooks = config.qwencode?.disableAllHooks;
    if (typeof disableAllHooks === "boolean") {
      merged.disableAllHooks = disableAllHooks;
    }
    const fileContent = JSON.stringify(merged, null, 2);
    return new QwencodeHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let settings: { hooks?: unknown; disableAllHooks?: unknown };
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Qwen Code hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = qwencodeHooksToCanonical(settings.hooks);
    // Preserve the top-level `disableAllHooks` switch under the qwencode namespace.
    const canonical: HooksConfig =
      typeof settings.disableAllHooks === "boolean"
        ? { version: 1, hooks, qwencode: { disableAllHooks: settings.disableAllHooks } }
        : { version: 1, hooks };
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(canonical, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): QwencodeHooks {
    return new QwencodeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
