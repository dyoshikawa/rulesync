import { join } from "node:path";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { HooksConfig } from "../../types/hooks.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";

import {
  CURSOR_HOOK_EVENTS,
  CURSOR_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_CURSOR_EVENT_NAMES,
} from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
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

  static getSettablePaths(): ToolHooksSettablePaths {
    return {
      relativeDirPath: ".cursor",
      relativeFilePath: "hooks.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolHooksFromFileParams): Promise<CursorHooks> {
    const paths = CursorHooks.getSettablePaths();
    const fileContent = await readFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new CursorHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
  }: ToolHooksFromRulesyncHooksParams): CursorHooks {
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
    const mappedHooks: HooksConfig["hooks"] = {};
    for (const [eventName, defs] of Object.entries(mergedHooks)) {
      const cursorEventName = CANONICAL_TO_CURSOR_EVENT_NAMES[eventName] ?? eventName;
      mappedHooks[cursorEventName] = defs;
    }
    const cursorConfig = {
      version: config.version ?? 1,
      hooks: mappedHooks,
    };
    const fileContent = JSON.stringify(cursorConfig, null, 2);
    const paths = CursorHooks.getSettablePaths();
    return new CursorHooks({
      baseDir,
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
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): CursorHooks {
    return new CursorHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
