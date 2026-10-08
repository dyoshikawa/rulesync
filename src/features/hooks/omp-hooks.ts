import { join } from "node:path";

import {
  OMP_EXTENSIONS_DIR_PATH,
  OMP_GLOBAL_EXTENSIONS_DIR_PATH,
  OMP_HOOKS_FILE_NAME,
} from "../../constants/omp-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { CANONICAL_TO_OMP_EVENT_NAMES, OMP_HOOK_EVENTS } from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
import { generatePiExtensionCode, OMP_EXTENSION_DIALECT } from "./pi-extension-generator.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * oh-my-pi (`omp`) hooks are TypeScript extension modules subscribing to
 * lifecycle events with `pi.on(...)`, like Pi's. rulesync bridges canonical
 * hooks by generating a rulesync-owned extension in oh-my-pi's native
 * extension discovery paths: `.omp/extensions/rulesync-hooks.ts` (project) and
 * `~/.omp/agent/extensions/rulesync-hooks.ts` (global, default profile).
 *
 * @see https://github.com/can1357/oh-my-pi/blob/40e9368ef0458fd9073329cdff4174895f91bc6b/docs/extensions.md
 * @see https://github.com/can1357/oh-my-pi/blob/40e9368ef0458fd9073329cdff4174895f91bc6b/docs/extension-loading.md
 */
export class OmpHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  static getSettablePaths(options?: { global?: boolean }): ToolHooksSettablePaths {
    return {
      relativeDirPath: options?.global ? OMP_GLOBAL_EXTENSIONS_DIR_PATH : OMP_EXTENSIONS_DIR_PATH,
      relativeFilePath: OMP_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<OmpHooks> {
    const paths = OmpHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new OmpHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): OmpHooks {
    const fileContent = generatePiExtensionCode({
      config: rulesyncHooks.getJson(),
      supportedEvents: OMP_HOOK_EVENTS,
      eventMap: CANONICAL_TO_OMP_EVENT_NAMES,
      dialect: OMP_EXTENSION_DIALECT,
    });
    const paths = OmpHooks.getSettablePaths({ global });
    return new OmpHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    throw new Error(
      "Not implemented because oh-my-pi hooks are generated as a TypeScript extension file.",
    );
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): OmpHooks {
    return new OmpHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
