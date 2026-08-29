import { join } from "node:path";

import {
  AUGMENTCODE_DIR,
  AUGMENTCODE_SETTINGS_FILE_NAME,
} from "../../constants/augmentcode-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  AUGMENTCODE_HOOK_EVENTS,
  AUGMENTCODE_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_AUGMENTCODE_EVENT_NAMES,
} from "../../types/hooks.js";
import { readAugmentcodeSettingsWithLocalOverlay } from "../../utils/augmentcode-settings.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import {
  buildImportedHooksConfig,
  canonicalToToolHooks,
  toolHooksToCanonical,
} from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

// Auggie only attaches a `matcher` to the tool events; the session lifecycle
// events (SessionStart / SessionEnd / Stop / Notification) never carry one. See
// https://docs.augmentcode.com/cli/hooks
const AUGMENTCODE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "sessionStart",
  "sessionEnd",
  "stop",
  "notification",
  // `PromptSubmit` fires once per submitted prompt, so it carries no matcher
  // either — the shipped CLI (`@augmentcode/auggie` 0.33.0, `augment.mjs`) lists
  // it in the same matcher-less enum as the four above.
  "beforeSubmitPrompt",
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
  supportedHookTypes: new Set(["command"]),
  // `metadata` is documented at https://docs.augmentcode.com/cli/hooks; `args`
  // appears only in the shipped CLI's validator (`@augmentcode/auggie` 0.33.0,
  // `augment.mjs`), which accepts it on a command hook. Both were previously
  // dropped on import and — because the `hooks` key is owned in the shared
  // settings file — erased from a hand-written settings.json on the next
  // generate.
  arrayPassthroughFields: [{ canonical: "args", tool: "args" }],
  groupPassthroughFields: [{ canonical: "metadata", tool: "metadata" }],
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
    return { relativeDirPath: AUGMENTCODE_DIR, relativeFilePath: AUGMENTCODE_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
    logger,
  }: ToolHooksFromFileParams): Promise<AugmentcodeHooks> {
    const paths = AugmentcodeHooks.getSettablePaths({ global });
    // On import, overlay the project-scope `.augment/settings.local.json`
    // (gitignored, machine-specific overrides) ON TOP OF `settings.json` so
    // user-local hook overrides are picked up. The overlay is project-only
    // (no global `~/.augment/settings.local.json` is documented), so it is
    // skipped in global mode.
    const fileContent = await readAugmentcodeSettingsWithLocalOverlay({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      baseFileName: paths.relativeFilePath,
      baseFallbackContent: '{"hooks":{}}',
      includeLocalOverlay: !global,
      logger,
    });
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
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    const config = rulesyncHooks.getJson();
    const augmentHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.augmentcode?.hooks,
      converterConfig: AUGMENTCODE_CONVERTER_CONFIG,
      logger,
    });
    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "hooks",
      existingContent,
      patch: { hooks: augmentHooks },
      filePath,
    });
    return new AugmentcodeHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
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
      logger,
      hooks: settings.hooks,
      converterConfig: AUGMENTCODE_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "augmentcode" }),
        null,
        2,
      ),
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
