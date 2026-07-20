import { join } from "node:path";

import {
  PI_AGENT_EXTENSIONS_DIR_PATH,
  PI_EXTENSIONS_DIR_PATH,
  PI_HOOKS_FILE_NAME,
} from "../../constants/pi-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { CANONICAL_TO_PI_EVENT_NAMES, PI_HOOK_EVENTS } from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
import { generatePiExtensionCode } from "./pi-extension-generator.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Pi Coding Agent has no static hooks config file; its extension API exposes
 * lifecycle events instead. rulesync bridges canonical hooks by generating a
 * rulesync-owned TypeScript extension in Pi's extension discovery paths:
 * `.pi/extensions/rulesync-hooks.ts` (project) and
 * `~/.pi/agent/extensions/rulesync-hooks.ts` (global).
 *
 * @see https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md
 */
export class PiHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  static getSettablePaths(options?: { global?: boolean }): ToolHooksSettablePaths {
    return {
      relativeDirPath: options?.global ? PI_AGENT_EXTENSIONS_DIR_PATH : PI_EXTENSIONS_DIR_PATH,
      relativeFilePath: PI_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<PiHooks> {
    const paths = PiHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new PiHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): PiHooks {
    const config = rulesyncHooks.getJson();
    const fileContent = generatePiExtensionCode(
      config,
      PI_HOOK_EVENTS,
      CANONICAL_TO_PI_EVENT_NAMES,
    );
    const paths = PiHooks.getSettablePaths({ global });
    return new PiHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    throw new Error(
      "Not implemented because Pi hooks are generated as a TypeScript extension file.",
    );
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): PiHooks {
    return new PiHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
