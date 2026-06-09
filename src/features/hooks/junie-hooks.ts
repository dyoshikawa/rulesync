import { join } from "node:path";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_JUNIE_EVENT_NAMES,
  JUNIE_HOOK_EVENTS,
  JUNIE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import { canonicalToToolHooks, toolHooksToCanonical } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const JUNIE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: JUNIE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_JUNIE_EVENT_NAMES,
  toolToCanonicalEventNames: JUNIE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  // Junie CLI hooks only support `type: "command"`; drop any `prompt`-type
  // hooks so generation matches the declared capability.
  supportedHookTypes: new Set(["command"]),
};

export class JunieHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // ~/.junie/config.json is the user's primary Junie CLI config and holds
    // other user settings besides hooks; it must never be deleted.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Junie CLI only runs user-scope hooks, so generation always targets
    // `~/.junie/config.json`. In global mode the same relative path is
    // resolved under the user home; project hooks are ignored by Junie.
    return { relativeDirPath: ".junie", relativeFilePath: "config.json" };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<JunieHooks> {
    const paths = JunieHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new JunieHooks({
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
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<JunieHooks> {
    const paths = JunieHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Junie config at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const junieHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.junie?.hooks,
      converterConfig: JUNIE_CONVERTER_CONFIG,
      logger,
    });
    const merged = { ...settings, hooks: junieHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new JunieHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let settings: { hooks?: unknown };
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Junie hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: settings.hooks,
      converterConfig: JUNIE_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): JunieHooks {
    // Kept for interface parity with other ToolHooks implementations even
    // though isDeletable() returns false (config.json is never deleted).
    return new JunieHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
