import { join } from "node:path";

import {
  KILO_GLOBAL_PLUGIN_DIR_PATH,
  KILO_GLOBAL_PLUGINS_DIR_PATH,
  KILO_HOOKS_FILE_NAME,
  KILO_PLUGIN_DIR_PATH,
  KILO_PLUGINS_DIR_PATH,
} from "../../constants/kilo-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { CANONICAL_TO_KILO_EVENT_NAMES, KILO_HOOK_EVENTS } from "../../types/hooks.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import { generateOpencodeStylePluginCode } from "./opencode-style-generator.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

export class KiloHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  static getSettablePaths(options?: { global?: boolean }): ToolHooksSettablePaths {
    return {
      relativeDirPath: options?.global ? KILO_GLOBAL_PLUGINS_DIR_PATH : KILO_PLUGINS_DIR_PATH,
      relativeFilePath: KILO_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<KiloHooks> {
    // Kilo loads plugins from both the plural `plugins/` and the singular
    // `plugin/` directory. The write side always targets the plural directory,
    // but on import we probe the plural directory first and fall back to the
    // singular one so a user's singular-dir plugin file is picked up too.
    // https://kilo.ai/docs/automate/extending/plugins
    const pluralDirPath = global ? KILO_GLOBAL_PLUGINS_DIR_PATH : KILO_PLUGINS_DIR_PATH;
    const singularDirPath = global ? KILO_GLOBAL_PLUGIN_DIR_PATH : KILO_PLUGIN_DIR_PATH;

    let relativeDirPath = pluralDirPath;
    let fileContent = await readFileContentOrNull(
      join(outputRoot, pluralDirPath, KILO_HOOKS_FILE_NAME),
    );
    if (fileContent === null) {
      const singularContent = await readFileContentOrNull(
        join(outputRoot, singularDirPath, KILO_HOOKS_FILE_NAME),
      );
      if (singularContent !== null) {
        relativeDirPath = singularDirPath;
        fileContent = singularContent;
      }
    }

    // Preserve the original throw-on-missing behavior when neither directory has
    // the plugin file: re-read the plural path so the error message points there.
    if (fileContent === null) {
      fileContent = await readFileContent(join(outputRoot, pluralDirPath, KILO_HOOKS_FILE_NAME));
    }

    return new KiloHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath: KILO_HOOKS_FILE_NAME,
      fileContent,
      validate,
    });
  }

  static fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): KiloHooks {
    const config = rulesyncHooks.getJson();
    // Kilo's canonical plugin shape is a default-export module descriptor
    // `export default { id, server }`. Named exports are documented as legacy,
    // so the Kilo target emits the default-export form (unlike OpenCode, which
    // keeps the named export). https://kilo.ai/docs/automate/extending/plugins
    const fileContent = generateOpencodeStylePluginCode(
      config,
      KILO_HOOK_EVENTS,
      "kilo",
      CANONICAL_TO_KILO_EVENT_NAMES,
      "default",
    );
    const paths = KiloHooks.getSettablePaths({ global });
    return new KiloHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    throw new Error("Not implemented because Kilo hooks are generated as a plugin file.");
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): KiloHooks {
    return new KiloHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
