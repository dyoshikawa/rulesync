import { join } from "node:path";

import { FIREBENDER_DIR, FIREBENDER_HOOKS_FILE_NAME } from "../../constants/firebender-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import { FIREBENDER_HOOK_EVENTS } from "../../types/hooks.js";
import type { ToolFile } from "../../types/tool-file.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { HOOKS_OWNERSHIP_LOCK_FILE_NAME, parseHooksOwnershipLock } from "./hooks-ownership-lock.js";
import { mergeGeneratedHookLists } from "./preserve-unowned-hook-commands.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import { buildImportedHooksConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Hooks generator for Firebender.
 *
 * Firebender reads `.firebender/hooks.json` (project) and
 * `~/.firebender/hooks.json` (global). The file follows Cursor's layout — a
 * `version` plus a `hooks` map from camelCase event names to lists of
 * `{ command, timeout?, loop_limit?, matcher? }` entries — and every event is
 * spelled like its canonical counterpart. Only command hooks are documented,
 * so other hook types are skipped (the HooksProcessor warns about them).
 *
 * @see https://docs.firebender.com/multi-agent/hooks
 */
export class FirebenderHooks extends ToolHooks {
  constructor(params: ToolHooksParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The same `.firebender/hooks.json` in both scopes; the home-directory
    // root is applied by the processor in global mode.
    return {
      relativeDirPath: FIREBENDER_DIR,
      relativeFilePath: FIREBENDER_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<FirebenderHooks> {
    const paths = FirebenderHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new FirebenderHooks({
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
    preserveUnowned = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<FirebenderHooks> {
    const config = rulesyncHooks.getJson();
    const supportedEvents: Set<string> = new Set(FIREBENDER_HOOK_EVENTS);
    const sharedHooks: HooksConfig["hooks"] = {};
    for (const [event, defs] of Object.entries(config.hooks)) {
      if (supportedEvents.has(event)) {
        sharedHooks[event] = defs;
      }
    }
    const mergedHooks: HooksConfig["hooks"] = {
      ...sharedHooks,
      ...config.firebender?.hooks,
    };

    const firebenderHooks: HooksConfig["hooks"] = {};
    for (const [eventName, defs] of Object.entries(mergedHooks)) {
      const mappedDefs = defs
        .filter((def) => (def.type ?? "command") === "command")
        .filter((def) => typeof def.command === "string" && def.command.length > 0)
        .map((def) => ({
          command: def.command,
          ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
          ...(def.loop_limit !== undefined && { loop_limit: def.loop_limit }),
          ...(def.matcher !== undefined && def.matcher !== null && { matcher: def.matcher }),
        }));
      if (mappedDefs.length > 0) {
        firebenderHooks[eventName] = mappedDefs;
      }
    }

    const paths = FirebenderHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const previouslyOwned = preserveUnowned
      ? parseHooksOwnershipLock(
          await readFileContentOrNull(
            join(outputRoot, paths.relativeDirPath, HOOKS_OWNERSHIP_LOCK_FILE_NAME),
          ),
        )
      : undefined;
    const merged = mergeGeneratedHookLists({
      existingContent,
      generatedHooks: firebenderHooks as Record<string, unknown[]>,
      shape: "flat",
      preserveUnowned,
      previouslyOwned,
      logger,
    });
    const fileContent = JSON.stringify(
      { version: config.version ?? 1, hooks: merged.hooks },
      null,
      2,
    );
    return new FirebenderHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      ownedHookRefs: preserveUnowned ? merged.owned : undefined,
      validate,
    });
  }

  static override supportsPreserveUnowned(): boolean {
    return true;
  }

  static override async getAuxiliaryFiles({
    toolHooks,
  }: {
    outputRoot?: string;
    global?: boolean;
    toolHooks?: ToolHooks;
    logger?: Logger;
  } = {}): Promise<ToolFile[]> {
    return toolHooks instanceof FirebenderHooks ? toolHooks.getOwnershipLockFiles() : [];
  }

  toRulesyncHooks(): RulesyncHooks {
    const parsed: { version?: number; hooks?: HooksConfig["hooks"] } = JSON.parse(
      this.getFileContent(),
    );
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({
          hooks: parsed.hooks ?? {},
          overrideKey: "firebender",
          version: parsed.version ?? 1,
        }),
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
  }: ToolHooksForDeletionParams): FirebenderHooks {
    return new FirebenderHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
