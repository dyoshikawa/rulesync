import { join } from "node:path";

import {
  AMP_HOOKS_FILE_NAME,
  AMP_PLUGINS_GLOBAL_DIR,
  AMP_PLUGINS_PROJECT_DIR,
} from "../../constants/amp-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { AMP_HOOK_EVENTS, CANONICAL_TO_AMP_EVENT_NAMES } from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
import { generateAmpPluginCode } from "./amp-plugin-generator.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/** Amp hooks adapter backed by a rulesync-owned TypeScript plugin. */
export class AmpHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({ ...params, fileContent: params.fileContent ?? "" });
  }

  static getSettablePaths(options?: { global?: boolean }): ToolHooksSettablePaths {
    return {
      relativeDirPath: options?.global ? AMP_PLUGINS_GLOBAL_DIR : AMP_PLUGINS_PROJECT_DIR,
      relativeFilePath: AMP_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<AmpHooks> {
    const paths = AmpHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new AmpHooks({ outputRoot, ...paths, fileContent, validate });
  }

  static fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): AmpHooks {
    const fileContent = generateAmpPluginCode({
      config: rulesyncHooks.getJson(),
      supportedEvents: AMP_HOOK_EVENTS,
      eventMap: CANONICAL_TO_AMP_EVENT_NAMES,
    });
    return new AmpHooks({
      outputRoot,
      ...AmpHooks.getSettablePaths({ global }),
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    throw new Error("Not implemented because generated Amp TypeScript plugins cannot be imported.");
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): AmpHooks {
    return new AmpHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
