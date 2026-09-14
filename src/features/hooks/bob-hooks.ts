import { join } from "node:path";

import {
  BOB_DIR,
  BOB_GLOBAL_SETTINGS_DIR_PATH,
  BOB_SETTINGS_FILE_NAME,
} from "../../constants/bob-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  BOB_HOOK_EVENTS,
  BOB_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_BOB_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
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

// Bob honours `matcher` (a regex over the tool name) only on the two tool
// events; SessionStart / UserPromptSubmit / Stop carry none.
// https://bob.ibm.com/docs/ide/configuration/lifecycle-hooks
const BOB_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "sessionStart",
  "beforeSubmitPrompt",
  "stop",
]);

// `projectDirVar` is empty: Bob documents no inline project-directory
// substitution for hook commands, so commands are emitted verbatim.
const BOB_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: BOB_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_BOB_EVENT_NAMES,
  toolToCanonicalEventNames: BOB_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  noMatcherEvents: BOB_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command"]),
};

/**
 * Single spelling of the settings.json codec/policy: fail closed on an
 * unparseable root rather than replacing the user's Bob settings with
 * generated output.
 */
function parseBobSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * IBM Bob lifecycle hooks.
 *
 * Hooks live under the top-level `hooks` key of Bob's settings file —
 * `<project>/.bob/settings.json` (project scope) and
 * `~/.bob/settings/settings.json` (user scope) — in the Claude-Code shape:
 * `{ "<Event>": [{ "matcher"?: "<regex>", "hooks": [{ "type": "command",
 * "command": "...", "timeout"?: <seconds> }] }] }`. The file also holds
 * settings rulesync does not own, so generation merges the `hooks` key into it
 * (see `SHARED_CONFIG_OWNERSHIP`) instead of overwriting the file.
 *
 * @see https://bob.ibm.com/docs/ide/configuration/lifecycle-hooks
 */
export class BobHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // settings.json carries user-managed settings beyond hooks, so it must
    // never be removed wholesale; clearing hooks happens via an in-place merge.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The user file sits one directory deeper than the project file; the
    // processor supplies the home directory as outputRoot in global mode.
    return {
      relativeDirPath: global ? BOB_GLOBAL_SETTINGS_DIR_PATH : BOB_DIR,
      relativeFilePath: BOB_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<BobHooks> {
    const paths = BobHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new BobHooks({
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
  }): Promise<BobHooks> {
    const paths = BobHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const config = rulesyncHooks.getJson();
    const hooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.bob?.hooks,
      converterConfig: BOB_CONVERTER_CONFIG,
      logger,
    });
    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "hooks",
      existingContent,
      patch: { hooks },
      filePath,
      logger,
    });
    return new BobHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const configPath = join(this.getRelativeDirPath(), this.getRelativeFilePath());
    let settings: Record<string, unknown>;
    try {
      settings = parseBobSettings(this.getFileContent(), configPath);
    } catch (error) {
      throw new Error(`Failed to parse Bob hooks content in ${configPath}: ${formatError(error)}`, {
        cause: error,
      });
    }
    const hooks = toolHooksToCanonical({
      logger,
      hooks: settings.hooks,
      converterConfig: BOB_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(buildImportedHooksConfig({ hooks, overrideKey: "bob" }), null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): BobHooks {
    return new BobHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
