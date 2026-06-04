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
 * Hook events supported by Windsurf Cascade Hooks (GA).
 *
 * Windsurf exposes 12 lifecycle events. Unlike Claude/Antigravity, each event
 * maps directly to a flat array of hook objects (no `matcher`, no `type`, no
 * inner `hooks` wrapper, and no `timeout`). A hook object carries `command`
 * and/or `powershell`, plus optional `show_output` and `working_directory`.
 *
 * Reference (Cascade Hooks GA):
 * - Project file:  `.windsurf/hooks.json`
 * - Global file:   `~/.codeium/windsurf/hooks.json`
 */
export const WINDSURF_HOOK_EVENT_NAMES = [
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

export type WindsurfHookEventName = (typeof WINDSURF_HOOK_EVENT_NAMES)[number];

/**
 * Map canonical camelCase event names to Windsurf event names.
 *
 * The mapping is bijective for every event with a Windsurf equivalent, so the
 * conversion round-trips cleanly. Windsurf splits the generic tool lifecycle
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
 * all twelve Windsurf events bijectively we therefore pair the second read/write
 * event by DOMAIN (read↔read, write↔write) rather than by timing, which inverts
 * the prefix on `post_read_code` (⇄ beforeTabFileRead) and `pre_write_code`
 * (⇄ afterTabFileEdit). The alternative — pairing by timing — would leave two
 * Windsurf events unmapped and drop user hooks. The round-trip stays lossless;
 * only the human-readable prefix differs, so this is a deliberate trade-off.
 *
 * Canonical events that have no Windsurf equivalent (e.g. sessionStart, stop)
 * are dropped with a logged warning during export.
 */
export const CANONICAL_TO_WINDSURF_EVENT_NAMES: Record<string, WindsurfHookEventName> = {
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
 * Map Windsurf event names back to canonical camelCase event names.
 */
export const WINDSURF_TO_CANONICAL_EVENT_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_WINDSURF_EVENT_NAMES).map(([k, v]) => [v, k]),
);

/**
 * Canonical hook events supported by Windsurf (the keys of the bijective map).
 *
 * Listed explicitly (rather than derived via `Object.keys`) so each value is
 * type-checked against `HookEvent` and stays in sync with
 * `CANONICAL_TO_WINDSURF_EVENT_NAMES`.
 */
export const WINDSURF_HOOK_EVENTS: readonly HookEvent[] = [
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
 * A single Windsurf hook object.
 *
 * At least one of `command` / `powershell` is required by Windsurf; the
 * converter preserves whatever is present and never invents `type`, `matcher`,
 * or `timeout` fields.
 */
type WindsurfHookObject = {
  command?: string;
  powershell?: string;
  show_output?: boolean;
  working_directory?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the per-tool `windsurf` override hooks from the rulesync hooks config.
 *
 * `HooksConfigSchema` surfaces an optional `windsurf` block (mirroring every
 * other hooks target), so the override hooks are read directly off the typed
 * config without any cast.
 */
function getWindsurfOverrideHooks(config: HooksConfig): HooksConfig["hooks"] {
  return config.windsurf?.hooks ?? {};
}

/**
 * Convert a canonical hook definition into a Windsurf hook object, keeping only
 * the Windsurf-supported fields. Returns null when neither command nor
 * powershell is present (Windsurf requires at least one of them).
 */
function canonicalDefToWindsurfHook(def: Record<string, unknown>): WindsurfHookObject | null {
  const hook: WindsurfHookObject = {};
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
 * Convert a Windsurf hook object into a canonical hook definition.
 */
function windsurfHookToCanonicalDef(hook: Record<string, unknown>): Record<string, unknown> {
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
 * Hooks generator for Windsurf Cascade (GA).
 *
 * Writes a dedicated `hooks.json` whose top-level `hooks` key maps each
 * Windsurf event name to a flat array of hook objects. Project and global modes
 * share the same shape; only the location differs (`.windsurf/hooks.json` vs
 * `~/.codeium/windsurf/hooks.json`). The harness overrides `outputRoot` with the
 * home directory in global mode.
 */
export class WindsurfHooks extends ToolHooks {
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
  }: ToolHooksFromFileParams): Promise<WindsurfHooks> {
    const paths = WindsurfHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({ hooks: {} });
    return new WindsurfHooks({
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
  }): Promise<WindsurfHooks> {
    const paths = WindsurfHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // hooks.json is dedicated to hooks, so any existing content is fully
    // replaced; reading it first keeps a stable round-trip when unchanged.
    await readOrInitializeFileContent(filePath, JSON.stringify({ hooks: {} }, null, 2));

    const config = rulesyncHooks.getJson();
    const supported: Set<string> = new Set(WINDSURF_HOOK_EVENTS);
    const sharedHooks: HooksConfig["hooks"] = {};
    for (const [event, defs] of Object.entries(config.hooks)) {
      if (supported.has(event)) {
        sharedHooks[event] = defs;
      }
    }
    // The per-tool override key (`windsurf`) is accessed through a guarded read
    // because the rulesync hooks schema passes unknown keys through
    // (z.looseObject) but does not surface them on the inferred type.
    const overrideHooks = getWindsurfOverrideHooks(config);
    const effectiveHooks: HooksConfig["hooks"] = {
      ...sharedHooks,
      ...overrideHooks,
    };

    const windsurfHooks: Record<string, WindsurfHookObject[]> = {};
    for (const [canonicalEvent, defs] of Object.entries(effectiveHooks)) {
      const windsurfEvent = CANONICAL_TO_WINDSURF_EVENT_NAMES[canonicalEvent];
      if (windsurfEvent === undefined) {
        logger?.warn(
          `Skipped hook event "${canonicalEvent}" for windsurf (no Windsurf equivalent)`,
        );
        continue;
      }
      const objects: WindsurfHookObject[] = [];
      for (const def of defs) {
        const hook = canonicalDefToWindsurfHook(def);
        if (hook !== null) {
          objects.push(hook);
        }
      }
      if (objects.length > 0) {
        windsurfHooks[windsurfEvent] = objects;
      }
    }

    const fileContent = JSON.stringify({ hooks: windsurfHooks }, null, 2);
    return new WindsurfHooks({
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
        `Failed to parse Windsurf hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    // Typed as a plain record (not HooksConfig["hooks"]) because this map is
    // only serialized to JSON for toRulesyncHooksDefault; this keeps the
    // canonical hook objects assignable without a type assertion.
    const canonicalHooks: Record<string, Record<string, unknown>[]> = {};
    const windsurfHooks = parsed.hooks;
    if (isRecord(windsurfHooks)) {
      for (const [windsurfEvent, rawObjects] of Object.entries(windsurfHooks)) {
        if (!Array.isArray(rawObjects)) {
          continue;
        }
        const canonicalEvent = WINDSURF_TO_CANONICAL_EVENT_NAMES[windsurfEvent];
        if (canonicalEvent === undefined) {
          // Unknown Windsurf event (not one of the documented 12). Drop it on
          // import for symmetry with the export side, which drops canonical
          // events that have no Windsurf equivalent. Passing it through would
          // let it survive import only to be silently dropped on the next
          // generate, hiding the data loss from the user.
          continue;
        }
        const defs: Record<string, unknown>[] = [];
        for (const rawObject of rawObjects) {
          if (!isRecord(rawObject)) {
            continue;
          }
          defs.push(windsurfHookToCanonicalDef(rawObject));
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
  }: ToolHooksForDeletionParams): WindsurfHooks {
    return new WindsurfHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
