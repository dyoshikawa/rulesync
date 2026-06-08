import { join } from "node:path";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { HookEvent, HooksConfig } from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Hook events supported by Devin Cascade Hooks (GA).
 *
 * Devin exposes 12 lifecycle events. Unlike Claude/Antigravity, each event
 * maps directly to a flat array of hook objects (no `matcher`, no `type`, no
 * inner `hooks` wrapper, and no `timeout`). A hook object carries `command`
 * and/or `powershell`, plus optional `show_output` and `working_directory`.
 *
 * Reference (Cascade Hooks GA):
 * - Project file:  `.windsurf/hooks.json`
 * - Global file:   `~/.codeium/windsurf/hooks.json`
 */
export const DEVIN_HOOK_EVENT_NAMES = [
  "pre_read_code",
  "post_read_code",
  "pre_write_code",
  "post_write_code",
  "pre_run_command",
  "post_run_command",
  "pre_mcp_tool_use",
  "post_mcp_tool_use",
  "pre_user_prompt",
  "post_cascade_response",
  "post_cascade_response_with_transcript",
  "post_setup_worktree",
] as const;

export type DevinHookEventName = (typeof DEVIN_HOOK_EVENT_NAMES)[number];

/**
 * Map canonical camelCase event names to Devin event names.
 *
 * The mapping is bijective for every event with a Devin equivalent, so the
 * conversion round-trips cleanly. Devin splits the generic tool lifecycle
 * into file/command/MCP specific events, so we line them up with the closest
 * file/command/MCP specific canonical events rather than the generic
 * preToolUse/postToolUse pair:
 *
 * - beforeReadFile      ⇄ pre_read_code
 * - beforeTabFileRead   ⇄ post_read_code
 * - afterTabFileEdit    ⇄ pre_write_code
 * - afterFileEdit       ⇄ post_write_code
 * - beforeShellExecution⇄ pre_run_command
 * - afterShellExecution ⇄ post_run_command
 * - beforeMCPExecution  ⇄ pre_mcp_tool_use
 * - afterMCPExecution   ⇄ post_mcp_tool_use
 * - beforeSubmitPrompt  ⇄ pre_user_prompt
 * - afterAgentResponse  ⇄ post_cascade_response
 * - beforeAgentResponse ⇄ post_cascade_response_with_transcript
 * - worktreeCreate      ⇄ post_setup_worktree
 *
 * NOTE on the before/after prefix mismatch: rulesync's canonical vocabulary has
 * no `afterReadFile` or `beforeWriteFile`/`beforeFileEdit` event — the only read
 * events are `beforeReadFile`/`beforeTabFileRead` (both read-side) and the only
 * edit events are `afterFileEdit`/`afterTabFileEdit` (both edit-side). To cover
 * all twelve Devin events bijectively we therefore pair the second read/write
 * event by DOMAIN (read↔read, write↔write) rather than by timing, which inverts
 * the prefix on `post_read_code` (⇄ beforeTabFileRead) and `pre_write_code`
 * (⇄ afterTabFileEdit). The alternative — pairing by timing — would leave two
 * Devin events unmapped and drop user hooks. The round-trip stays lossless;
 * only the human-readable prefix differs, so this is a deliberate trade-off.
 *
 * Canonical events that have no Devin equivalent (e.g. sessionStart, stop)
 * are dropped with a logged warning during export.
 */
export const CANONICAL_TO_DEVIN_EVENT_NAMES: Record<string, DevinHookEventName> = {
  beforeReadFile: "pre_read_code",
  beforeTabFileRead: "post_read_code",
  afterTabFileEdit: "pre_write_code",
  afterFileEdit: "post_write_code",
  beforeShellExecution: "pre_run_command",
  afterShellExecution: "post_run_command",
  beforeMCPExecution: "pre_mcp_tool_use",
  afterMCPExecution: "post_mcp_tool_use",
  beforeSubmitPrompt: "pre_user_prompt",
  afterAgentResponse: "post_cascade_response",
  beforeAgentResponse: "post_cascade_response_with_transcript",
  worktreeCreate: "post_setup_worktree",
};

/**
 * Map Devin event names back to canonical camelCase event names.
 */
export const DEVIN_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_DEVIN_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Canonical hook events supported by Devin (the keys of the bijective map).
 *
 * Listed explicitly (rather than derived via `Object.keys`) so each value is
 * type-checked against `HookEvent` and stays in sync with
 * `CANONICAL_TO_DEVIN_EVENT_NAMES`.
 */
export const DEVIN_HOOK_EVENTS: readonly HookEvent[] = [
  "beforeReadFile",
  "beforeTabFileRead",
  "afterTabFileEdit",
  "afterFileEdit",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeSubmitPrompt",
  "afterAgentResponse",
  "beforeAgentResponse",
  "worktreeCreate",
];

/**
 * A single Devin hook object.
 *
 * At least one of `command` / `powershell` is required by Devin; the
 * converter preserves whatever is present and never invents `type`, `matcher`,
 * or `timeout` fields.
 */
type DevinHookObject = {
  command?: string;
  powershell?: string;
  show_output?: boolean;
  working_directory?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the per-tool `devin` override hooks from the rulesync hooks config.
 *
 * `HooksConfigSchema` surfaces an optional `devin` block (mirroring every
 * other hooks target), so the override hooks are read directly off the typed
 * config without any cast.
 */
function getDevinOverrideHooks(config: HooksConfig): HooksConfig["hooks"] {
  return config.devin?.hooks ?? {};
}

/**
 * Convert a canonical hook definition into a Devin hook object, keeping only
 * the Devin-supported fields. Returns null when neither command nor
 * powershell is present (Devin requires at least one of them).
 */
function canonicalDefToDevinHook(def: Record<string, unknown>): DevinHookObject | null {
  const hook: DevinHookObject = {};
  if (typeof def.command === "string") {
    hook.command = def.command;
  }
  if (typeof def.powershell === "string") {
    hook.powershell = def.powershell;
  }
  if (typeof def.show_output === "boolean") {
    hook.show_output = def.show_output;
  }
  if (typeof def.working_directory === "string") {
    hook.working_directory = def.working_directory;
  }
  if (hook.command === undefined && hook.powershell === undefined) {
    return null;
  }
  return hook;
}

/**
 * Convert a Devin hook object into a canonical hook definition.
 */
function devinHookToCanonicalDef(hook: Record<string, unknown>): Record<string, unknown> {
  const def: Record<string, unknown> = { type: "command" };
  if (typeof hook.command === "string") {
    def.command = hook.command;
  }
  if (typeof hook.powershell === "string") {
    def.powershell = hook.powershell;
  }
  if (typeof hook.show_output === "boolean") {
    def.show_output = hook.show_output;
  }
  if (typeof hook.working_directory === "string") {
    def.working_directory = hook.working_directory;
  }
  return def;
}

/**
 * Hooks generator for Devin Cascade (GA).
 *
 * Writes a dedicated `hooks.json` whose top-level `hooks` key maps each
 * Devin event name to a flat array of hook objects. Project and global modes
 * share the same shape; only the location differs (`.windsurf/hooks.json` vs
 * `~/.codeium/windsurf/hooks.json`). The harness overrides `outputRoot` with the
 * home directory in global mode.
 */
export class DevinHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? JSON.stringify({ hooks: {} }, null, 2),
    });
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    if (global) {
      return {
        relativeDirPath: join(".codeium", "windsurf"),
        relativeFilePath: "hooks.json",
      };
    }
    return {
      relativeDirPath: ".windsurf",
      relativeFilePath: "hooks.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<DevinHooks> {
    const paths = DevinHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({ hooks: {} });
    return new DevinHooks({
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
  }): Promise<DevinHooks> {
    const paths = DevinHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // hooks.json is dedicated to hooks, so any existing content is fully
    // replaced; reading it first keeps a stable round-trip when unchanged.
    await readOrInitializeFileContent(filePath, JSON.stringify({ hooks: {} }, null, 2));

    const config = rulesyncHooks.getJson();
    const supported: Set<string> = new Set(DEVIN_HOOK_EVENTS);
    const sharedHooks: HooksConfig["hooks"] = {};
    for (const [event, defs] of Object.entries(config.hooks)) {
      if (supported.has(event)) {
        sharedHooks[event] = defs;
      }
    }
    // The per-tool override key (`devin`) is accessed through a guarded read
    // because the rulesync hooks schema passes unknown keys through
    // (z.looseObject) but does not surface them on the inferred type.
    const overrideHooks = getDevinOverrideHooks(config);
    const effectiveHooks: HooksConfig["hooks"] = {
      ...sharedHooks,
      ...overrideHooks,
    };

    const devinHooks: Record<string, DevinHookObject[]> = {};
    for (const [canonicalEvent, defs] of Object.entries(effectiveHooks)) {
      const devinEvent = CANONICAL_TO_DEVIN_EVENT_NAMES[canonicalEvent];
      if (devinEvent === undefined) {
        logger?.warn(`Skipped hook event "${canonicalEvent}" for devin (no Devin equivalent)`);
        continue;
      }
      const objects: DevinHookObject[] = [];
      for (const def of defs) {
        const hook = canonicalDefToDevinHook(def);
        if (hook !== null) {
          objects.push(hook);
        }
      }
      if (objects.length > 0) {
        devinHooks[devinEvent] = objects;
      }
    }

    const fileContent = JSON.stringify({ hooks: devinHooks }, null, 2);
    return new DevinHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: { hooks?: unknown };
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Devin hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    // Typed as a plain record (not HooksConfig["hooks"]) because this map is
    // only serialized to JSON for toRulesyncHooksDefault; this keeps the
    // canonical hook objects assignable without a type assertion.
    const canonicalHooks: Record<string, Record<string, unknown>[]> = {};
    const devinHooks = parsed.hooks;
    if (isRecord(devinHooks)) {
      for (const [devinEvent, rawObjects] of Object.entries(devinHooks)) {
        if (!Array.isArray(rawObjects)) {
          continue;
        }
        const canonicalEvent = DEVIN_TO_CANONICAL_EVENT_NAMES[devinEvent];
        if (canonicalEvent === undefined) {
          // Unknown Devin event (not one of the documented 12). Drop it on
          // import for symmetry with the export side, which drops canonical
          // events that have no Devin equivalent. Passing it through would
          // let it survive import only to be silently dropped on the next
          // generate, hiding the data loss from the user.
          continue;
        }
        const defs: Record<string, unknown>[] = [];
        for (const rawObject of rawObjects) {
          if (!isRecord(rawObject)) {
            continue;
          }
          defs.push(devinHookToCanonicalDef(rawObject));
        }
        if (defs.length > 0) {
          canonicalHooks[canonicalEvent] = defs;
        }
      }
    }

    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks: canonicalHooks }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): DevinHooks {
    return new DevinHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
