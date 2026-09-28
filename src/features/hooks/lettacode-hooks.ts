import { join } from "node:path";

import { LETTACODE_DIR, LETTACODE_SETTINGS_FILE_NAME } from "../../constants/lettacode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_LETTACODE_EVENT_NAMES,
  LETTACODE_HOOK_EVENTS,
  LETTACODE_TO_CANONICAL_EVENT_NAMES,
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

// Letta Code tests `matcher` (a regex; `*` and an empty string match every
// tool) only on the four tool events; the remaining events fire on every
// occurrence and carry none.
// https://github.com/letta-ai/letta-code/blob/main/src/hooks/types.ts
const LETTACODE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "notification",
  "stop",
  "subagentStop",
  "preCompact",
]);

// `projectDirVar` is intentionally empty: Letta Code documents no project-root
// variable for hook commands and spawns every hook with the project directory
// as its working directory (`src/hooks/executor.ts`), so relative commands are
// emitted verbatim. `timeout` is in milliseconds (default 60000), so the
// canonical seconds are converted both ways. Only `command` hooks are emitted:
// Letta's `prompt` hooks exist on a subset of events only.
const LETTACODE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: LETTACODE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_LETTACODE_EVENT_NAMES,
  toolToCanonicalEventNames: LETTACODE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  noMatcherEvents: LETTACODE_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command"]),
  timeoutUnit: "milliseconds",
};

/**
 * Letta Code keeps a boolean `disabled` switch beside the event arrays inside
 * `hooks`. rulesync owns the whole `hooks` key, so the switch is read back from
 * the existing file and carried into the generated one instead of being lost.
 */
function readHooksDisabled(existingContent: string): boolean | undefined {
  try {
    const hooks = parseLettacodeSettings(existingContent).hooks;
    if (hooks !== null && typeof hooks === "object" && "disabled" in hooks) {
      return typeof hooks.disabled === "boolean" ? hooks.disabled : undefined;
    }
  } catch {
    // An unparseable file is reported by `applySharedConfigPatch` below.
  }
  return undefined;
}

/**
 * Single spelling of the settings codec/policy: fail closed on an unparseable
 * root rather than replacing the user's Letta Code settings with generated
 * output.
 */
function parseLettacodeSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * Letta Code hooks.
 *
 * Hooks live under the top-level `hooks` key of `<project>/.letta/settings.json`
 * (project scope) and `~/.letta/settings.json` (user scope), in the
 * Claude-Code shape: `{ "<Event>": [{ "matcher"?: "<regex>", "hooks": [{
 * "type": "command", "command": "...", "timeout"?: <milliseconds> }] }] }`.
 * Both files also hold settings rulesync does not own (`permissions`, model
 * and UI preferences, ...), so generation merges the `hooks` key into the
 * existing file (see `SHARED_CONFIG_OWNERSHIP`) instead of overwriting it.
 *
 * @see https://github.com/letta-ai/letta-code/blob/main/src/hooks/types.ts
 * @see https://github.com/letta-ai/letta-code/blob/main/src/hooks/loader.ts
 */
export class LettacodeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // settings.json carries user-managed settings beyond hooks, so it is never
    // removed wholesale; clearing hooks happens via an in-place merge.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The same relative path is used for both scopes; the processor supplies
    // the home directory as outputRoot in global mode.
    return {
      relativeDirPath: LETTACODE_DIR,
      relativeFilePath: LETTACODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<LettacodeHooks> {
    const paths = LettacodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new LettacodeHooks({
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
  }): Promise<LettacodeHooks> {
    const paths = LettacodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const config = rulesyncHooks.getJson();
    const disabled = readHooksDisabled(existingContent);
    const hooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.lettacode?.hooks,
      converterConfig: LETTACODE_CONVERTER_CONFIG,
      logger,
    });
    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "hooks",
      existingContent,
      patch: { hooks: disabled === undefined ? hooks : { ...hooks, disabled } },
      filePath,
      logger,
    });
    return new LettacodeHooks({
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
      settings = parseLettacodeSettings(this.getFileContent(), configPath);
    } catch (error) {
      throw new Error(
        `Failed to parse Letta Code hooks content in ${configPath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      logger,
      hooks: settings.hooks,
      converterConfig: LETTACODE_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "lettacode" }),
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
  }: ToolHooksForDeletionParams): LettacodeHooks {
    return new LettacodeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
