import { join } from "node:path";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import {
  CURSOR_HOOK_EVENTS,
  CURSOR_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_CURSOR_EVENT_NAMES,
} from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

export type CursorHooksConstructorParams = AiFileParams & {
  rulesyncHooks?: RulesyncHooks;
};

export class CursorHooks extends ToolHooks {
  constructor(params: CursorHooksConstructorParams) {
    const { rulesyncHooks: _r, ...rest } = params;
    super({
      ...rest,
      fileContent: rest.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Cursor uses the same `.cursor/hooks.json` filename for both project and
    // global scope. The only thing that changes is the resolution root
    // (project root vs. home directory), which the harness handles by
    // overriding `outputRoot` when `--global` is passed.
    // Reference: https://cursor.com/docs/agent/hooks
    return {
      relativeDirPath: ".cursor",
      relativeFilePath: "hooks.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CursorHooks> {
    const paths = CursorHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new CursorHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): CursorHooks {
    const config = rulesyncHooks.getJson();
    const cursorSupported: Set<string> = new Set(CURSOR_HOOK_EVENTS);
    const sharedHooks: HooksConfig["hooks"] = {};
    for (const [event, defs] of Object.entries(config.hooks)) {
      if (cursorSupported.has(event)) {
        sharedHooks[event] = defs;
      }
    }
    const mergedHooks: HooksConfig["hooks"] = {
      ...sharedHooks,
      ...config.cursor?.hooks,
    };
    // Map canonical event names to Cursor event names.
    // Currently an identity mapping (camelCase → camelCase), but this loop maintains
    // architectural consistency with other tool converters (Claude, Factory Droid) and
    // becomes essential if Cursor's event naming diverges from canonical in the future.
    const mappedHooks: HooksConfig["hooks"] = {};
    for (const [eventName, defs] of Object.entries(mergedHooks)) {
      const cursorEventName = CANONICAL_TO_CURSOR_EVENT_NAMES[eventName] ?? eventName;
      mappedHooks[cursorEventName] = defs.map((def) => ({
        ...(def.type !== undefined && def.type !== null && { type: def.type }),
        ...(def.command !== undefined && def.command !== null && { command: def.command }),
        ...(def.timeout !== undefined && def.timeout !== null && { timeout: def.timeout }),
        ...(def.loop_limit !== undefined && { loop_limit: def.loop_limit }),
        ...(def.matcher !== undefined && def.matcher !== null && { matcher: def.matcher }),
        ...(def.prompt !== undefined && def.prompt !== null && { prompt: def.prompt }),
      }));
    }
    const cursorConfig = {
      version: config.version ?? 1,
      hooks: mappedHooks,
    };
    const fileContent = JSON.stringify(cursorConfig, null, 2);
    const paths = CursorHooks.getSettablePaths({ global });
    return new CursorHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      rulesyncHooks,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    const content = this.getFileContent();
    const parsed: { version?: number; hooks?: HooksConfig["hooks"] } = JSON.parse(content);
    const cursorHooks = parsed.hooks ?? {};
    // Map Cursor event names back to canonical event names.
    // Currently identity but kept explicit for forward compatibility
    // (see CANONICAL_TO_CURSOR_EVENT_NAMES in types/hooks.ts).
    const canonicalHooks: HooksConfig["hooks"] = {};
    for (const [cursorEventName, defs] of Object.entries(cursorHooks)) {
      const eventName = CURSOR_TO_CANONICAL_EVENT_NAMES[cursorEventName] ?? cursorEventName;
      canonicalHooks[eventName] = defs;
    }
    const version = parsed.version ?? 1;
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version, hooks: canonicalHooks }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): CursorHooks {
    return new CursorHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
