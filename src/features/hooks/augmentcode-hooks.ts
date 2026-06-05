import { join } from "node:path";

import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  AUGMENTCODE_HOOK_EVENTS,
  AUGMENTCODE_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_AUGMENTCODE_EVENT_NAMES,
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

// Auggie only attaches a `matcher` to the tool events; the session lifecycle
// events (SessionStart / SessionEnd / Stop) never carry one. See
// https://docs.augmentcode.com/cli/hooks
const AUGMENTCODE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "sessionStart",
  "sessionEnd",
  "stop",
]);

// `projectDirVar` is intentionally empty: Auggie exposes `AUGMENT_PROJECT_DIR`
// only as a runtime environment variable, not as an inline command substitution,
// so commands are emitted verbatim without a directory prefix.
const AUGMENTCODE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: AUGMENTCODE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_AUGMENTCODE_EVENT_NAMES,
  toolToCanonicalEventNames: AUGMENTCODE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  noMatcherEvents: AUGMENTCODE_NO_MATCHER_EVENTS,
};

/**
 * AugmentCode (Auggie CLI) lifecycle hooks.
 *
 * Hooks live under the top-level `hooks` key of the shared AugmentCode settings
 * file (`.augment/settings.json` for project scope, `~/.augment/settings.json`
 * for global scope). That same file also holds `toolPermissions`, so generation
 * merges the `hooks` block into the existing settings instead of overwriting it.
 *
 * @see https://docs.augmentcode.com/cli/hooks
 */
export class AugmentcodeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // settings.json is shared with the permissions feature, so it must never be
    // removed wholesale; clearing hooks happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Both project and global scope use the same relative path; the global
    // variant is resolved against the home directory by the caller.
    return { relativeDirPath: ".augment", relativeFilePath: "settings.json" };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<AugmentcodeHooks> {
    const paths = AugmentcodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new AugmentcodeHooks({
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
  }): Promise<AugmentcodeHooks> {
    const paths = AugmentcodeHooks.getSettablePaths({ global });
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
        `Failed to parse existing AugmentCode settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const config = rulesyncHooks.getJson();
    const augmentHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.augmentcode?.hooks,
      converterConfig: AUGMENTCODE_CONVERTER_CONFIG,
      logger,
    });
    const merged = { ...settings, hooks: augmentHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new AugmentcodeHooks({
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
        `Failed to parse AugmentCode hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: settings.hooks,
      converterConfig: AUGMENTCODE_CONVERTER_CONFIG,
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
  }: ToolHooksForDeletionParams): AugmentcodeHooks {
    return new AugmentcodeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
