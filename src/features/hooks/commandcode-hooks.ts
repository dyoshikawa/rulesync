import { join } from "node:path";

import {
  COMMANDCODE_DIR,
  COMMANDCODE_SETTINGS_FILE_NAME,
} from "../../constants/commandcode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_COMMANDCODE_EVENT_NAMES,
  COMMANDCODE_HOOK_EVENTS,
  COMMANDCODE_TO_CANONICAL_EVENT_NAMES,
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

// Command Code documents `matcher` as a regex over the tool name (`shell`,
// `read`, `write`, `edit`) for the two tool events; Stop and SessionStart
// fire on every occurrence and carry none.
// https://commandcode.ai/docs/hooks
const COMMANDCODE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set(["stop", "sessionStart"]);

// `$COMMANDCODE_PROJECT_DIR` is the documented project-root variable for hook
// commands, so dot-relative scripts are anchored to it the way Claude Code
// anchors them to `$CLAUDE_PROJECT_DIR`. `timeout` is in seconds (canonical
// unit). Only `command` hooks exist.
const COMMANDCODE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: COMMANDCODE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_COMMANDCODE_EVENT_NAMES,
  toolToCanonicalEventNames: COMMANDCODE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$COMMANDCODE_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: COMMANDCODE_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command"]),
};

/**
 * Single spelling of the settings codec/policy: fail closed on an unparseable
 * root rather than replacing the user's Command Code settings with generated
 * output.
 */
function parseCommandcodeSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * Command Code hooks.
 *
 * Hooks live under the top-level `hooks` key of `<project>/.commandcode/settings.json`
 * (project scope) and `~/.commandcode/settings.json` (user scope), in the
 * Claude-Code shape: `{ "<Event>": [{ "matcher"?: "<regex>", "hooks": [{
 * "type": "command", "command": "...", "timeout"?: <seconds> }] }] }`. Both
 * files also hold settings rulesync does not own (`permissions`, `defaultMode`,
 * ...), so generation merges the `hooks` key into the existing file (see
 * `SHARED_CONFIG_OWNERSHIP`) instead of overwriting it.
 *
 * @see https://commandcode.ai/docs/hooks
 * @see https://commandcode.ai/docs/settings
 */
export class CommandcodeHooks extends ToolHooks {
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
      relativeDirPath: COMMANDCODE_DIR,
      relativeFilePath: COMMANDCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CommandcodeHooks> {
    const paths = CommandcodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CommandcodeHooks({
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
  }): Promise<CommandcodeHooks> {
    const paths = CommandcodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const config = rulesyncHooks.getJson();
    const hooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.commandcode?.hooks,
      converterConfig: COMMANDCODE_CONVERTER_CONFIG,
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
    return new CommandcodeHooks({
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
      settings = parseCommandcodeSettings(this.getFileContent(), configPath);
    } catch (error) {
      throw new Error(
        `Failed to parse Command Code hooks content in ${configPath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      logger,
      hooks: settings.hooks,
      converterConfig: COMMANDCODE_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "commandcode" }),
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
  }: ToolHooksForDeletionParams): CommandcodeHooks {
    return new CommandcodeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
