import { join } from "node:path";

import {
  CLINE_HOOKS_DIR_PATH,
  CLINE_HOOKS_GLOBAL_DIR_PATH,
  CLINE_HOOKS_MANIFEST_FILE_NAME,
} from "../../constants/cline-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { CANONICAL_TO_CLINE_EVENT_NAMES, type HooksConfig } from "../../types/hooks.js";
import { ToolFile } from "../../types/tool-file.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  CLINE_HOOK_SCRIPT_MARKER,
  collectClineHookCommands,
  generateClineHookPowerShellScript,
  generateClineHookScript,
} from "./cline-hooks-generator.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/** Mode Cline's hook scripts need: it spawns the file itself on Unix. */
const HOOK_SCRIPT_MODE = 0o755;

type ClineHooksManifest = { generatedBy: string; events: string[] };

/** The only file names this adapter ever writes into the hooks directory. */
const MANAGED_EVENT_NAMES = new Set(Object.values(CANONICAL_TO_CLINE_EVENT_NAMES));

/**
 * Read the manifest of a previous run. Event names are filtered against the
 * names this adapter emits: the manifest is a file in the repository, and
 * anything else there would otherwise be turned into a path — an executable one
 * — that rulesync writes.
 */
function parseManifest(fileContent: string): ClineHooksManifest | null {
  try {
    const parsed: unknown = JSON.parse(fileContent);
    if (!isRecord(parsed) || !isStringArray(parsed.events)) return null;
    return {
      generatedBy: "rulesync",
      events: parsed.events.filter((event) => MANAGED_EVENT_NAMES.has(event)),
    };
  } catch {
    return null;
  }
}

/** One generated hook script. Written executable so Cline can spawn it. */
class ClineHookScript extends ToolFile {
  override getFileMode(): number | undefined {
    // Only the POSIX script is executed by path; the `.ps1` twin is passed to
    // `powershell -File`, which does not need the bit.
    return this.getRelativeFilePath().endsWith(".ps1") ? undefined : HOOK_SCRIPT_MODE;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

/**
 * Hooks adapter for Cline's file-based hooks.
 *
 * Cline (VS Code extension / Cline Desktop) resolves one executable per
 * lifecycle event from `<project>/.clinerules/hooks/` or the global
 * `~/Documents/Cline/Hooks/`, named exactly after the event: the extensionless
 * name on Unix, `<Event>.ps1` on Windows. The script receives the event payload
 * as JSON on stdin and answers with `{"cancel": …, "contextModification": …,
 * "errorMessage": …}` on stdout. rulesync emits a wrapper script per configured
 * event in both spellings, plus a `rulesync-hooks.json` manifest naming the
 * scripts it owns.
 *
 * The directory is shared with hand-authored hooks and the filenames are fixed
 * by the contract, so every generated script carries a marker line and a script
 * without it is never overwritten.
 *
 * The project hooks directory is in the search paths of both the VS Code
 * extension and the SDK/CLI, whose accepted event names differ slightly, so the
 * emitted set is their union ({@link CANONICAL_TO_CLINE_EVENT_NAMES}). Cline's
 * in-process hook surface (`AgentHooks` from `@cline/core`) is a separate
 * mechanism this adapter does not target.
 *
 * @see https://github.com/cline/cline/blob/main/apps/vscode/src/core/hooks/utils.ts
 * @see https://github.com/cline/cline/blob/main/sdk/packages/core/src/hooks/hook-file-config.ts
 */
export class ClineHooks extends ToolHooks {
  private readonly scriptsByEvent: Record<string, string[]>;

  constructor(params: AiFileParams & { scriptsByEvent?: Record<string, string[]> }) {
    super({ ...params, fileContent: params.fileContent ?? "" });
    this.scriptsByEvent = params.scriptsByEvent ?? {};
  }

  static getSettablePaths(options?: { global?: boolean }): ToolHooksSettablePaths {
    return {
      relativeDirPath: options?.global ? CLINE_HOOKS_GLOBAL_DIR_PATH : CLINE_HOOKS_DIR_PATH,
      relativeFilePath: CLINE_HOOKS_MANIFEST_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<ClineHooks> {
    const paths = ClineHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new ClineHooks({ outputRoot, ...paths, fileContent, validate });
  }

  static fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): ClineHooks {
    const config = rulesyncHooks.getJson();
    const overrideHooks =
      (config.cline as { hooks?: HooksConfig["hooks"] } | undefined)?.hooks ?? {};
    const scriptsByEvent = collectClineHookCommands({
      effectiveHooks: { ...config.hooks, ...overrideHooks },
      eventMap: CANONICAL_TO_CLINE_EVENT_NAMES,
    });

    const manifest: ClineHooksManifest = {
      generatedBy: "rulesync",
      events: Object.keys(scriptsByEvent).toSorted(),
    };

    return new ClineHooks({
      outputRoot,
      ...ClineHooks.getSettablePaths({ global }),
      fileContent: `${JSON.stringify(manifest, null, 2)}\n`,
      validate,
      scriptsByEvent,
    });
  }

  /**
   * The per-event scripts, plus a neutralized script for every event a previous
   * run generated and this one no longer covers — those files stay on disk (the
   * hooks feature only reconciles its single settable path), so they are
   * rewritten as no-ops instead of being left running a removed hook.
   */
  async getScriptFiles({
    global = false,
    logger,
  }: { global?: boolean; logger?: Logger } = {}): Promise<ToolFile[]> {
    const paths = ClineHooks.getSettablePaths({ global });
    const previous =
      parseManifest(
        (await readFileContentOrNull(
          join(this.outputRoot, paths.relativeDirPath, paths.relativeFilePath),
        )) ?? "",
      )?.events ?? [];

    const events = [...new Set([...Object.keys(this.scriptsByEvent), ...previous])].toSorted();
    const files: ToolFile[] = [];
    for (const event of events) {
      const commands = this.scriptsByEvent[event] ?? [];
      for (const [relativeFilePath, fileContent] of [
        [event, generateClineHookScript({ event, commands })],
        [`${event}.ps1`, generateClineHookPowerShellScript({ event, commands })],
      ] as const) {
        const existing = await readFileContentOrNull(
          join(this.outputRoot, paths.relativeDirPath, relativeFilePath),
        );
        // Never clobber a hook the user wrote themselves: the event filenames
        // are fixed by Cline, so a collision is expected rather than exotic.
        if (existing !== null && !existing.includes(CLINE_HOOK_SCRIPT_MARKER)) {
          logger?.warn(
            `Kept the existing ${join(paths.relativeDirPath, relativeFilePath)}: it was not ` +
              `generated by rulesync, so the ${event} hook from .rulesync/hooks.jsonc is not ` +
              `written. Remove or rename that file to let rulesync manage the event.`,
          );
          continue;
        }
        files.push(
          new ClineHookScript({
            outputRoot: this.outputRoot,
            relativeDirPath: paths.relativeDirPath,
            relativeFilePath,
            fileContent,
          }),
        );
      }
    }
    return files;
  }

  /**
   * The generated scripts ride alongside the manifest. Only a `ClineHooks`
   * instance can produce them, so the processor hands its freshly built one
   * back here.
   */
  static override async getAuxiliaryFiles({
    global = false,
    toolHooks,
    logger,
  }: {
    outputRoot?: string;
    global?: boolean;
    toolHooks?: ToolHooks;
    logger?: Logger;
  } = {}): Promise<ToolFile[]> {
    if (!(toolHooks instanceof ClineHooks)) return [];
    return toolHooks.getScriptFiles({ global, logger });
  }

  /**
   * Every rulesync-marked script currently on disk. Dropping the target must
   * take the scripts with it: they hold the actual commands, and leaving them
   * behind keeps a removed hook running.
   */
  static override async getDeletableAuxiliaryFiles({
    outputRoot = process.cwd(),
    global = false,
  }: {
    outputRoot?: string;
    global?: boolean;
  } = {}): Promise<ToolFile[]> {
    const paths = ClineHooks.getSettablePaths({ global });
    const files: ToolFile[] = [];
    for (const event of [...MANAGED_EVENT_NAMES].toSorted()) {
      for (const relativeFilePath of [event, `${event}.ps1`]) {
        const existing = await readFileContentOrNull(
          join(outputRoot, paths.relativeDirPath, relativeFilePath),
        );
        if (existing === null || !existing.includes(CLINE_HOOK_SCRIPT_MARKER)) continue;
        files.push(
          new ClineHookScript({
            outputRoot,
            relativeDirPath: paths.relativeDirPath,
            relativeFilePath,
            fileContent: "",
            validate: false,
          }),
        );
      }
    }
    return files;
  }

  toRulesyncHooks(): RulesyncHooks {
    throw new Error(
      "Not implemented because generated Cline hook scripts cannot be imported back into canonical hooks.",
    );
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): ClineHooks {
    return new ClineHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
