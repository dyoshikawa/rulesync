import { join } from "node:path";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { CANONICAL_TO_KILO_EVENT_NAMES, KILO_HOOK_EVENTS } from "../../types/hooks.js";
import { readFileContent } from "../../utils/file.js";
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
      relativeDirPath: options?.global
        ? join(".config", "kilo", "plugins")
        : join(".kilo", "plugins"),
      relativeFilePath: "rulesync-hooks.js",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<KiloHooks> {
    const paths = KiloHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new KiloHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): KiloHooks {
    const config = rulesyncHooks.getJson();
    const fileContent = generateOpencodeStylePluginCode(
      config,
      KILO_HOOK_EVENTS,
      "kilo",
      CANONICAL_TO_KILO_EVENT_NAMES,
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
