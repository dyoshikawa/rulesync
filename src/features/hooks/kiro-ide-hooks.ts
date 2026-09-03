import { join } from "node:path";

import { z } from "zod/mini";

import { KIRO_IDE_HOOKS_DIR_PATH, KIRO_IDE_HOOKS_FILE_NAME } from "../../constants/kiro-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HookDefinition, HooksConfig } from "../../types/hooks.js";
import {
  CANONICAL_TO_KIRO_IDE_EVENT_NAMES,
  KIRO_IDE_HOOK_EVENTS,
  KIRO_IDE_TO_CANONICAL_EVENT_NAMES,
  KIRO_LEGACY_TO_KIRO_IDE_TRIGGER_NAMES,
  safeString,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * One hook entry inside the Kiro IDE v1 `hooks` array.
 *
 * `z.looseObject` keeps unknown fields added by future Kiro IDE versions, so
 * imports do not drop data they do not yet understand.
 * @see https://kiro.dev/docs/hooks/types/
 */
const KiroIdeHookActionSchema = z.union([
  z.looseObject({ type: z.literal("command"), command: z.optional(safeString) }),
  z.looseObject({ type: z.literal("agent"), prompt: z.optional(safeString) }),
]);

const KiroIdeHookEntrySchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  trigger: z.optional(z.string()),
  matcher: z.optional(z.string()),
  action: z.optional(KiroIdeHookActionSchema),
  timeout: z.optional(z.number()),
  enabled: z.optional(z.boolean()),
});

const KiroIdeHooksFileSchema = z.looseObject({
  version: z.optional(z.string()),
  hooks: z.optional(z.array(KiroIdeHookEntrySchema)),
});

type KiroIdeHookEntry = z.infer<typeof KiroIdeHookEntrySchema>;

/**
 * Build the Kiro IDE hook entries for a single canonical event's definitions.
 *
 * `command`-type definitions become `{ type: "command", command }` actions and
 * `prompt`-type definitions become `{ type: "agent", prompt }` actions. Other
 * types are skipped (the {@link import("./hooks-processor.js").HooksProcessor}
 * already warns about unsupported types).
 */
function buildKiroIdeEntriesForEvent(
  trigger: string,
  definitions: HooksConfig["hooks"][string],
): KiroIdeHookEntry[] {
  const entries: KiroIdeHookEntry[] = [];
  for (const def of definitions) {
    const type = def.type ?? "command";

    let action: KiroIdeHookEntry["action"];
    if (type === "command") {
      if (def.command === undefined) continue;
      action = { type: "command", command: def.command };
    } else if (type === "prompt") {
      if (def.prompt === undefined) continue;
      action = { type: "agent", prompt: def.prompt };
    } else {
      continue;
    }

    entries.push({
      // `name` is required by Kiro for telemetry; fall back to the trigger name.
      name: def.name ?? trigger,
      ...(def.description !== undefined &&
        def.description !== null && { description: def.description }),
      trigger,
      ...(def.matcher !== undefined &&
        def.matcher !== null &&
        def.matcher !== "" && { matcher: def.matcher }),
      action,
      // Kiro IDE timeout is expressed in seconds; `0` explicitly disables it.
      // Emit any non-negative timeout (including `0`) so the value round-trips.
      ...(def.timeout !== undefined &&
        def.timeout !== null &&
        def.timeout >= 0 && { timeout: def.timeout }),
      // Kiro defaults `enabled` to `true`; an imported `enabled: false` is
      // preserved so regenerating does not silently reactivate the hook.
      enabled: def.enabled ?? true,
    });
  }
  return entries;
}

/**
 * The single `HooksConfig` key every Kiro target reads its tool-specific
 * overrides from.
 *
 * `kiro-ide` and `kiro-cli` write the same `.kiro/hooks/rulesync.json` at both
 * scopes, so per-target override blocks would make that one file's content
 * depend on generation order (last writer wins). All Kiro variants therefore
 * share the `kiro` block — the same resolution the Kiro MCP and permissions
 * wiring already use for the file they share.
 */
export const KIRO_HOOKS_OVERRIDE_KEY = "kiro";

/**
 * Override keys a user might reach for that nothing reads, mapped to the key
 * that is actually read.
 */
const KIRO_HOOKS_IGNORED_OVERRIDE_KEYS = ["kiro-ide", "kiro-cli"] as const;

function canonicalToKiroIdeHooks(config: HooksConfig): KiroIdeHookEntry[] {
  const kiroIdeSupported: Set<string> = new Set(KIRO_IDE_HOOK_EVENTS);
  const sharedHooks: HooksConfig["hooks"] = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (kiroIdeSupported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks: HooksConfig["hooks"] = {
    ...sharedHooks,
    // Tool-specific overrides bypass the KIRO_IDE_HOOK_EVENTS filter by design:
    // users targeting Kiro directly may reference triggers such as
    // `PostFileSave` or `PreTaskExec`, which pass through unchanged.
    ...config[KIRO_HOOKS_OVERRIDE_KEY]?.hooks,
  };

  const entries: KiroIdeHookEntry[] = [];
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    // The shared `kiro` block is also read by the deprecated alias, whose
    // format spells the same events differently (`agentSpawn`, `fileEdited`,
    // …). Those spellings are translated to their v1 trigger rather than
    // emitted verbatim, which would write a trigger this format does not
    // define. Anything else still passes through unchanged.
    const trigger =
      lookupOwn({ record: CANONICAL_TO_KIRO_IDE_EVENT_NAMES, key: eventName }) ??
      lookupOwn({ record: KIRO_LEGACY_TO_KIRO_IDE_TRIGGER_NAMES, key: eventName }) ??
      eventName;
    entries.push(...buildKiroIdeEntriesForEvent(trigger, definitions));
  }
  return entries;
}

function kiroIdeHooksToCanonical(entries: KiroIdeHookEntry[]): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  for (const entry of entries) {
    if (entry.trigger === undefined || entry.action === undefined) continue;
    const eventName =
      lookupOwn({ record: KIRO_IDE_TO_CANONICAL_EVENT_NAMES, key: entry.trigger }) ?? entry.trigger;
    // A crafted `trigger` (e.g. "__proto__") would otherwise make the
    // `canonical[eventName] ??= []` bracket access resolve to a prototype member
    // and throw; skip prototype-pollution keys defensively.
    if (isPrototypePollutionKey(eventName)) continue;

    const def: HookDefinition = {};
    if (entry.action.type === "command") {
      if (!entry.action.command) continue;
      def.type = "command";
      def.command = entry.action.command;
    } else {
      if (!entry.action.prompt) continue;
      def.type = "prompt";
      def.prompt = entry.action.prompt;
    }
    if (entry.name !== undefined && entry.name !== null) def.name = entry.name;
    if (entry.description !== undefined && entry.description !== null) {
      def.description = entry.description;
    }
    if (entry.matcher !== undefined && entry.matcher !== null && entry.matcher !== "") {
      def.matcher = entry.matcher;
    }
    if (entry.timeout !== undefined && entry.timeout !== null) def.timeout = entry.timeout;
    // Only carry an explicit `false`: `true` is Kiro's default, so re-emitting
    // it would add noise to every imported hook definition.
    if (entry.enabled === false) def.enabled = false;

    const list = lookupOwn({ record: canonical, key: eventName }) ?? [];
    list.push(def);
    canonical[eventName] = list;
  }
  return canonical;
}

/**
 * Hooks generator for the standalone Kiro hooks format (`.kiro/hooks/*.json`
 * v1), used by the **Kiro IDE** and, since Kiro CLI 3.0, by the CLI too.
 *
 * Kiro reads structured JSON hooks from `.kiro/hooks/` (workspace) and
 * `~/.kiro/hooks/` (user). A single file may declare multiple hooks in its
 * `hooks` array, so rulesync emits every generated hook into one
 * `rulesync.json` file per scope (`{ "version": "v1", "hooks": [ ... ] }`),
 * which keeps it within the single-file hooks architecture.
 *
 * {@link import("./kiro-cli-hooks.js").KiroCliHooks} subclasses this to write
 * the same format for the `kiro-cli` target; only the deprecated `kiro` alias
 * still writes the embedded `.kiro/agents/default.json` agent-config shape,
 * which Kiro CLI 3.0 no longer reads.
 *
 * Because both targets write the very same file, they resolve their
 * tool-specific overrides from one shared block
 * ({@link KIRO_HOOKS_OVERRIDE_KEY}) rather than per-target blocks, so
 * generating either or both targets always yields the same file.
 *
 * @see https://kiro.dev/docs/hooks/
 */
export class KiroIdeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? JSON.stringify({ version: "v1", hooks: [] }, null, 2),
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: KIRO_IDE_HOOKS_DIR_PATH,
      relativeFilePath: KIRO_IDE_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<KiroIdeHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent =
      (await readFileContentOrNull(filePath)) ??
      JSON.stringify({ version: "v1", hooks: [] }, null, 2);
    return new this({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<KiroIdeHooks> {
    const paths = this.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();

    // A block authored under a per-target name is not read by anything —
    // surface that instead of silently dropping the hooks in it.
    for (const ignoredKey of KIRO_HOOKS_IGNORED_OVERRIDE_KEYS) {
      if (config[ignoredKey]?.hooks === undefined) continue;
      logger?.warn(
        `The "${ignoredKey}.hooks" block in ${join(rulesyncHooks.getRelativeDirPath(), rulesyncHooks.getRelativeFilePath())} is ignored. Author it under the "${KIRO_HOOKS_OVERRIDE_KEY}.hooks" key instead: the Kiro IDE and Kiro CLI targets write the same hooks file, so they read one shared block.`,
      );
    }

    const hooks = canonicalToKiroIdeHooks(config);
    const fileContent = JSON.stringify({ version: "v1", hooks }, null, 2);
    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: z.infer<typeof KiroIdeHooksFileSchema>;
    try {
      parsed = KiroIdeHooksFileSchema.parse(JSON.parse(this.getFileContent()));
    } catch (error) {
      throw new Error(
        `Failed to parse Kiro IDE hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const hooks = kiroIdeHooksToCanonical(parsed.hooks ?? []);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: KIRO_HOOKS_OVERRIDE_KEY }),
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
  }: ToolHooksForDeletionParams): KiroIdeHooks {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ version: "v1", hooks: [] }, null, 2),
      validate: false,
    });
  }
}
