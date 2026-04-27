import { join } from "node:path";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { CANONICAL_TO_OPENCODE_EVENT_NAMES, OPENCODE_HOOK_EVENTS } from "../../types/hooks.js";
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

export class OpencodeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  static getSettablePaths(options?: { global?: boolean }): ToolHooksSettablePaths {
    return {
      relativeDirPath: options?.global
        ? join(".config", "opencode", "plugins")
        : join(".opencode", "plugins"),
      relativeFilePath: "rulesync-hooks.js",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<OpencodeHooks> {
    const paths = OpencodeHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new OpencodeHooks({
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
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): OpencodeHooks {
    const config = rulesyncHooks.getJson();
    const fileContent = generateOpencodeStylePluginCode(
      config,
      OPENCODE_HOOK_EVENTS,
      "opencode",
      CANONICAL_TO_OPENCODE_EVENT_NAMES,
    );
    const paths = OpencodeHooks.getSettablePaths({ global });
    return new OpencodeHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    throw new Error("Not implemented because OpenCode hooks are generated as a plugin file.");
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): OpencodeHooks {
    return new OpencodeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
