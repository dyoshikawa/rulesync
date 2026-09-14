import { join } from "node:path";

import { CONTINUE_DIR, CONTINUE_SETTINGS_FILE_NAME } from "../../constants/continue-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_CONTINUE_EVENT_NAMES,
  CONTINUE_HOOK_EVENTS,
  CONTINUE_TO_CANONICAL_EVENT_NAMES,
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

// The CLI's `NO_MATCHER_EVENTS`: these fire on every occurrence and ignore
// `matcher`. Every other event compiles `matcher` as a regex over its subject
// (`*` and an empty string mean "all").
// https://github.com/continuedev/continue/blob/main/extensions/cli/src/hooks/types.ts
const CONTINUE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "beforeSubmitPrompt",
  "stop",
  "teammateIdle",
  "taskCompleted",
  "worktreeCreate",
  "worktreeRemove",
]);

// Continue's hook schema is a copy of Claude Code's, so the handler types and
// the per-hook fields map one to one: `command` / `http` / `prompt` / `agent`
// handlers, `timeout` in seconds, `statusMessage` and `once` on every handler,
// `async` on command handlers and `model` on prompt / agent handlers.
// `$CONTINUE_PROJECT_DIR` is the working directory the CLI exports to hook
// commands, so dot-relative scripts are anchored to it.
// https://github.com/continuedev/continue/blob/main/extensions/cli/src/hooks/types.ts
// https://github.com/continuedev/continue/blob/main/extensions/cli/src/hooks/hookRunner.ts
const CONTINUE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CONTINUE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CONTINUE_EVENT_NAMES,
  toolToCanonicalEventNames: CONTINUE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$CONTINUE_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: CONTINUE_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command", "prompt", "http", "agent"]),
  emitsPromptModel: true,
  stringPassthroughFields: [{ canonical: "statusMessage", tool: "statusMessage" }],
  booleanPassthroughFields: [
    { canonical: "once", tool: "once" },
    { canonical: "async", tool: "async", commandOnly: true },
  ],
};

/**
 * Single spelling of the settings/hooks codec/policy: fail closed on an
 * unparseable root rather than replacing the user's Continue settings with
 * generated output.
 */
function parseContinueSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * Continue CLI hooks.
 *
 * Hooks live under the top-level `hooks` key of `<project>/.continue/settings.json`
 * (project scope) and `~/.continue/settings.json` (user scope), in the
 * Claude-Code shape: `{ "<Event>": [{ "matcher"?: "<regex>", "hooks": [{
 * "type": "command" | "http" | "prompt" | "agent", ..., "timeout"?: <seconds>
 * }] }] }`. Both files also hold settings rulesync does not own, so generation
 * merges the `hooks` key into the existing file (see `SHARED_CONFIG_OWNERSHIP`)
 * instead of overwriting it. The CLI additionally reads
 * `.continue/settings.local.json` and the Claude Code settings files; rulesync
 * writes only the committable project file and the user file.
 *
 * @see https://github.com/continuedev/continue/blob/main/extensions/cli/src/hooks/hookConfig.ts
 * @see https://github.com/continuedev/continue/blob/main/extensions/cli/src/hooks/types.ts
 */
export class ContinueHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // settings.json carries user-managed settings beyond hooks in both scopes,
    // so it is never removed wholesale; clearing hooks happens via an in-place
    // merge.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The processor supplies the home directory as outputRoot in global mode;
    // the file layout is the same in both scopes.
    return { relativeDirPath: CONTINUE_DIR, relativeFilePath: CONTINUE_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<ContinueHooks> {
    const paths = ContinueHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new ContinueHooks({
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
  }): Promise<ContinueHooks> {
    const paths = ContinueHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const config = rulesyncHooks.getJson();
    const hooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.continue?.hooks,
      converterConfig: CONTINUE_CONVERTER_CONFIG,
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
    return new ContinueHooks({
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
      settings = parseContinueSettings(this.getFileContent(), configPath);
    } catch (error) {
      throw new Error(
        `Failed to parse Continue hooks content in ${configPath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      logger,
      hooks: settings.hooks,
      converterConfig: CONTINUE_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "continue" }),
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
  }: ToolHooksForDeletionParams): ContinueHooks {
    return new ContinueHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
