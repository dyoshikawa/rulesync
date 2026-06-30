import { join } from "node:path";

import { z } from "zod/mini";

import { KIRO_IDE_HOOKS_DIR_PATH, KIRO_IDE_HOOKS_FILE_NAME } from "../../constants/kiro-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HookDefinition, HooksConfig } from "../../types/hooks.js";
import {
  CANONICAL_TO_KIRO_IDE_EVENT_NAMES,
  KIRO_IDE_HOOK_EVENTS,
  KIRO_IDE_TO_CANONICAL_EVENT_NAMES,
  safeString,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
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
      enabled: true,
    });
  }
  return entries;
}

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
    // users targeting `kiro-ide` directly may reference IDE-only triggers such
    // as `PostFileSave` or `PreTaskExec`, which pass through unchanged.
    ...config["kiro-ide"]?.hooks,
  };

  const entries: KiroIdeHookEntry[] = [];
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const trigger = CANONICAL_TO_KIRO_IDE_EVENT_NAMES[eventName] ?? eventName;
    entries.push(...buildKiroIdeEntriesForEvent(trigger, definitions));
  }
  return entries;
}

function kiroIdeHooksToCanonical(entries: KiroIdeHookEntry[]): HooksConfig["hooks"] {
  const canonical: HooksConfig["hooks"] = {};
  for (const entry of entries) {
    if (entry.trigger === undefined || entry.action === undefined) continue;
    const eventName = KIRO_IDE_TO_CANONICAL_EVENT_NAMES[entry.trigger] ?? entry.trigger;
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

    (canonical[eventName] ??= []).push(def);
  }
  return canonical;
}

/**
 * Hooks generator for the **Kiro IDE** (`.kiro/hooks/*.json` v1).
 *
 * Kiro IDE 1.0 reads structured JSON hooks from `.kiro/hooks/` (workspace) and
 * `~/.kiro/hooks/` (user). A single file may declare multiple hooks in its
 * `hooks` array, so rulesync emits every generated hook into one
 * `rulesync.json` file per scope (`{ "version": "v1", "hooks": [ ... ] }`),
 * which keeps it within the single-file hooks architecture.
 *
 * This is distinct from the Kiro CLI ({@link import("./kiro-cli-hooks.js").
 * KiroCliHooks}), which uses the `.kiro/agents/default.json` agent-config shape.
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
    const paths = KiroIdeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent =
      (await readFileContentOrNull(filePath)) ??
      JSON.stringify({ version: "v1", hooks: [] }, null, 2);
    return new KiroIdeHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<KiroIdeHooks> {
    const paths = KiroIdeHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const hooks = canonicalToKiroIdeHooks(config);
    const fileContent = JSON.stringify({ version: "v1", hooks }, null, 2);
    return new KiroIdeHooks({
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
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
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
    return new KiroIdeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ version: "v1", hooks: [] }, null, 2),
      validate: false,
    });
  }
}
