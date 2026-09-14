import { join } from "node:path";

import {
  CORTEXCODE_DIR,
  CORTEXCODE_GLOBAL_DIR_PATH,
  CORTEXCODE_GLOBAL_HOOKS_FILE_NAME,
  CORTEXCODE_SETTINGS_FILE_NAME,
} from "../../constants/cortexcode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_CORTEXCODE_EVENT_NAMES,
  CORTEXCODE_HOOK_EVENTS,
  CORTEXCODE_TO_CANONICAL_EVENT_NAMES,
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

// Cortex Code documents `matcher` as a regex over the tool name (`*` is the
// documented match-all spelling); UserPromptSubmit and Stop fire on every
// occurrence and carry none.
// https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
const CORTEXCODE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set(["beforeSubmitPrompt", "stop"]);

// `$CORTEX_PROJECT_DIR` is the documented project-root variable for hook
// commands, so dot-relative scripts are anchored to it the way Claude Code
// anchors them to `$CLAUDE_PROJECT_DIR`. `timeout` is in seconds (canonical
// unit) and the documented per-hook `enabled` flag round-trips as-is.
const CORTEXCODE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CORTEXCODE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CORTEXCODE_EVENT_NAMES,
  toolToCanonicalEventNames: CORTEXCODE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$CORTEX_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: CORTEXCODE_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command", "prompt"]),
  booleanPassthroughFields: [{ canonical: "enabled", tool: "enabled" }],
};

/**
 * Single spelling of the settings/hooks codec/policy: fail closed on an
 * unparseable root rather than replacing the user's Cortex Code settings with
 * generated output.
 */
function parseCortexcodeSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * Snowflake Cortex Code hooks.
 *
 * Hooks live under the top-level `hooks` key of `<project>/.cortex/settings.json`
 * (project scope) and of the dedicated `~/.snowflake/cortex/hooks.json` (user
 * scope), both in the Claude-Code shape: `{ "<Event>": [{ "matcher"?:
 * "<regex>", "hooks": [{ "type": "command" | "prompt", ..., "timeout"?:
 * <seconds>, "enabled"?: <boolean> }] }] }`. The project file also holds
 * settings rulesync does not own, so generation merges the `hooks` key into
 * either file (see `SHARED_CONFIG_OWNERSHIP`) instead of overwriting it.
 *
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/settings
 */
export class CortexcodeHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // settings.json carries user-managed settings beyond hooks, and hooks.json
    // sits in the CLI-owned `~/.snowflake/cortex/` tree, so neither is removed
    // wholesale; clearing hooks happens via an in-place merge.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The processor supplies the home directory as outputRoot in global mode,
    // where hooks have their own file instead of a settings.json key.
    return global
      ? {
          relativeDirPath: CORTEXCODE_GLOBAL_DIR_PATH,
          relativeFilePath: CORTEXCODE_GLOBAL_HOOKS_FILE_NAME,
        }
      : {
          relativeDirPath: CORTEXCODE_DIR,
          relativeFilePath: CORTEXCODE_SETTINGS_FILE_NAME,
        };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CortexcodeHooks> {
    const paths = CortexcodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CortexcodeHooks({
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
  }): Promise<CortexcodeHooks> {
    const paths = CortexcodeHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const config = rulesyncHooks.getJson();
    const hooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.cortexcode?.hooks,
      converterConfig: CORTEXCODE_CONVERTER_CONFIG,
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
    return new CortexcodeHooks({
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
      settings = parseCortexcodeSettings(this.getFileContent(), configPath);
    } catch (error) {
      throw new Error(
        `Failed to parse Cortex Code hooks content in ${configPath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      logger,
      hooks: settings.hooks,
      converterConfig: CORTEXCODE_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "cortexcode" }),
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
  }: ToolHooksForDeletionParams): CortexcodeHooks {
    return new CortexcodeHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
