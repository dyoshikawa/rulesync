import { join } from "node:path";

import { z } from "zod/mini";

import {
  TABNINE_AGENT_DIR_PATH,
  TABNINE_SETTINGS_FILE_NAME,
} from "../../constants/tabnine-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  CANONICAL_TO_TABNINE_EVENT_NAMES,
  CONTROL_CHARS,
  TABNINE_HOOK_EVENTS,
  TABNINE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { compact } from "../../utils/object.js";
import { lookupOwn } from "../../utils/own-lookup.js";
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

type HookDefinition = HooksConfig["hooks"][string][number];

/**
 * Environment block safe to hand Tabnine for a hook. A tool rebuilds each
 * entry into `KEY=VALUE` for the spawned process, so a key holding `=`, a
 * control character or nothing at all names a different variable than it
 * appears to; such entries are dropped in both directions (with a warning on
 * export, where the value came from an authored `.rulesync/hooks.*`).
 */
function sanitizeEnv({
  env,
  warn,
}: {
  env: unknown;
  warn?: (message: string) => void;
}): Record<string, string> | undefined {
  if (env === null || env === undefined || typeof env !== "object" || Array.isArray(env)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const unsafeKey =
      key === "" || key.includes("=") || CONTROL_CHARS.some((char) => key.includes(char));
    const unsafeValue =
      typeof value !== "string" || CONTROL_CHARS.some((char) => value.includes(char));
    if (unsafeKey || unsafeValue) {
      warn?.(
        `Tabnine CLI hook env entry ${JSON.stringify(key)} is not a safe KEY=VALUE pair; skipping it.`,
      );
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Build one Tabnine hook configuration from a canonical command definition.
 * Canonical `timeout` is seconds (docs/reference/file-formats.md); Tabnine's is
 * milliseconds.
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/hooks/configuration
 */
function canonicalDefToTabnineHook({
  def,
  warn,
}: {
  def: HookDefinition;
  warn?: (message: string) => void;
}): Record<string, unknown> {
  return {
    type: "command",
    ...compact({
      command: def.command,
      name: def.name,
      description: def.description,
      timeout:
        typeof def.timeout === "number" && Number.isFinite(def.timeout)
          ? Math.round(def.timeout * 1000)
          : undefined,
      env: sanitizeEnv({ env: def.env, warn }),
    }),
  };
}

/**
 * Convert the canonical hooks config to Tabnine's `hooks` map: PascalCase
 * event names, matcher groups with an optional `sequential` flag, and
 * command-only hook entries. Tabnine treats an omitted `matcher` as match-all
 * and compiles tool-event matchers as regular expressions, so the canonical
 * catch-all `"*"` (not a valid regex) is emitted as no matcher. Commands are
 * passed through verbatim; Tabnine expands `$TABNINE_PROJECT_DIR` itself.
 */
function canonicalToTabnineHooks({
  config,
  logger,
}: {
  config: HooksConfig;
  logger?: Logger;
}): Record<string, unknown[]> {
  const warn = (message: string) => logger?.warn(message);
  const supported: ReadonlySet<string> = new Set(TABNINE_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    ...config.tabnine?.hooks,
  };
  const tabnine: Record<string, unknown[]> = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const tabnineEventName =
      lookupOwn({ record: CANONICAL_TO_TABNINE_EVENT_NAMES, key: eventName }) ?? eventName;
    const byMatcher = new Map<string, HookDefinition[]>();
    for (const def of definitions) {
      const hookType = def.type ?? "command";
      if (hookType !== "command") {
        // The HooksProcessor already warns about unsupported types per target.
        continue;
      }
      if (typeof def.command !== "string" || def.command === "") {
        warn(
          `Tabnine CLI hook on '${eventName}' has no 'command'; Tabnine would discard it, so it is skipped.`,
        );
        continue;
      }
      const key = def.matcher === undefined || def.matcher === "*" ? "" : def.matcher;
      const list = byMatcher.get(key);
      if (list) list.push(def);
      else byMatcher.set(key, [def]);
    }
    const entries: unknown[] = [];
    for (const [matcherKey, defs] of byMatcher) {
      const hooks = defs.map((def) => canonicalDefToTabnineHook({ def, warn }));
      // A matcher group runs sequentially when any of its definitions opt in;
      // Tabnine defaults to parallel execution, so only emit when true.
      const sequential = defs.some((def) => def.sequential === true);
      const group: Record<string, unknown> = matcherKey
        ? { matcher: matcherKey, hooks }
        : { hooks };
      if (sequential) {
        group.sequential = true;
      }
      entries.push(group);
    }
    if (entries.length > 0) {
      tabnine[tabnineEventName] = entries;
    }
  }
  return tabnine;
}

/**
 * Tabnine hook configuration as stored in each matcher group's `hooks` array.
 * `z.looseObject` keeps fields added by future Tabnine releases.
 */
const TabnineHookEntrySchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  timeout: z.optional(z.number()),
  env: z.optional(z.record(z.string(), z.string())),
});

const TabnineMatcherEntrySchema = z.looseObject({
  matcher: z.optional(z.string()),
  sequential: z.optional(z.boolean()),
  hooks: z.optional(z.array(TabnineHookEntrySchema)),
});

function tabnineMatcherEntryToCanonical(
  entry: z.infer<typeof TabnineMatcherEntrySchema>,
): HookDefinition[] {
  const sequential = entry.sequential === true;
  const matcher =
    entry.matcher !== undefined && entry.matcher !== null && entry.matcher !== ""
      ? entry.matcher
      : undefined;
  const defs: HookDefinition[] = [];
  for (const hook of entry.hooks ?? []) {
    // Tabnine documents `command` as the only hook type and silently discards
    // hooks without one; mirror that on import instead of inventing a type.
    if (hook.type !== "command" || typeof hook.command !== "string" || hook.command === "") {
      continue;
    }
    defs.push({
      type: "command",
      ...compact({
        command: hook.command,
        name: hook.name,
        description: hook.description,
        timeout:
          typeof hook.timeout === "number" && Number.isFinite(hook.timeout)
            ? hook.timeout / 1000
            : undefined,
        env: sanitizeEnv({ env: hook.env }),
        sequential: sequential ? true : undefined,
        matcher,
      }),
    });
  }
  return defs;
}

/**
 * Extract the `hooks` map of a Tabnine settings file into canonical form.
 */
function tabnineHooksToCanonical(tabnineHooks: unknown): HooksConfig["hooks"] {
  if (tabnineHooks === null || tabnineHooks === undefined || typeof tabnineHooks !== "object") {
    return {};
  }
  const canonical: HooksConfig["hooks"] = {};
  for (const [tabnineEventName, matcherEntries] of Object.entries(tabnineHooks)) {
    const eventName =
      lookupOwn({ record: TABNINE_TO_CANONICAL_EVENT_NAMES, key: tabnineEventName }) ??
      tabnineEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs: HookDefinition[] = [];
    for (const rawEntry of matcherEntries) {
      const parseResult = TabnineMatcherEntrySchema.safeParse(rawEntry);
      if (!parseResult.success) continue;
      defs.push(...tabnineMatcherEntryToCanonical(parseResult.data));
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}

/**
 * Fail closed on an unparseable settings root rather than replacing the
 * user's Tabnine settings with generated output.
 */
function parseTabnineSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * Tabnine CLI hooks.
 *
 * Hooks live under the top-level `hooks` key of Tabnine's settings file —
 * `<project>/.tabnine/agent/settings.json` (project scope) and
 * `~/.tabnine/agent/settings.json` (user scope). The file also carries
 * `mcpServers`, `tools` and other user-managed settings, so generation merges
 * the `hooks` key into it (see `SHARED_CONFIG_OWNERSHIP`) instead of
 * overwriting the file. The sibling `hooksConfig` block (master toggle,
 * disabled list, notifications) is left to the user.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/hooks
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/hooks/configuration
 */
export class TabnineHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // settings.json carries user-managed settings beyond hooks, so it must
    // never be removed wholesale; clearing hooks happens via an in-place merge.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The user file sits at the same relative path under the home directory;
    // the processor supplies the home directory as outputRoot in global mode.
    return {
      relativeDirPath: TABNINE_AGENT_DIR_PATH,
      relativeFilePath: TABNINE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<TabnineHooks> {
    const paths = TabnineHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new TabnineHooks({
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
  }): Promise<TabnineHooks> {
    const paths = TabnineHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const config = rulesyncHooks.getJson();
    const hooks = canonicalToTabnineHooks({ config, logger });
    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "hooks",
      existingContent,
      patch: { hooks },
      filePath,
      logger,
    });
    return new TabnineHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    const configPath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    let settings: Record<string, unknown>;
    try {
      settings = parseTabnineSettings(this.getFileContent(), configPath);
    } catch (error) {
      throw new Error(
        `Failed to parse Tabnine CLI hooks content in ${configPath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = tabnineHooksToCanonical(settings.hooks);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "tabnine" }),
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): TabnineHooks {
    return new TabnineHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
