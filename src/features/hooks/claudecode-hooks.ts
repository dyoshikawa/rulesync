import { join } from "node:path";

import { CLAUDECODE_DIR, CLAUDECODE_SETTINGS_FILE_NAME } from "../../constants/claudecode-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  CLAUDE_HOOK_EVENTS,
  CLAUDE_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_CLAUDE_EVENT_NAMES,
} from "../../types/hooks.js";
import type { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  applySharedConfigPatch,
  CLAUDE_SETTINGS_SHARED_FILE_KEY,
} from "../shared/shared-config-gateway.js";
import { HOOKS_OWNERSHIP_LOCK_FILE_NAME, parseHooksOwnershipLock } from "./hooks-ownership-lock.js";
import { mergeGeneratedHookLists } from "./preserve-unowned-hook-commands.js";
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
  type ToolHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const CLAUDE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "worktreeCreate",
  "worktreeRemove",
  "messageDisplay",
  // Documented as firing on every occurrence with no tool/argument matcher.
  // @see https://code.claude.com/docs/en/hooks#hook-events
  "postToolBatch",
  "taskCreated",
  "taskCompleted",
  "teammateIdle",
  "cwdChanged",
  "beforeSubmitPrompt",
  "stop",
]);

const CLAUDE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CLAUDE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CLAUDE_EVENT_NAMES,
  toolToCanonicalEventNames: CLAUDE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$CLAUDE_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: CLAUDE_NO_MATCHER_EVENTS,
  // All five documented Claude Code handler types round-trip faithfully:
  // the shared converter carries each type's payload fields (`url`/`headers`/
  // `allowedEnvVars` for http, `server`/`tool`/`input` for mcp_tool, `model`
  // for prompt/agent). https://code.claude.com/docs/en/hooks
  supportedHookTypes: new Set(["command", "prompt", "http", "mcp_tool", "agent"]),
  // Claude Code documents a per-hook `model` selector on prompt/agent hooks.
  emitsPromptModel: true,
  // Claude Code's tool-event `if` condition (a single permission rule) is
  // Claude-Code-specific and round-trips as an opaque string.
  // https://code.claude.com/docs/en/hooks
  stringPassthroughFields: [
    { canonical: "if", tool: "if" },
    // Common to every handler type: the spinner label shown while it runs.
    { canonical: "statusMessage", tool: "statusMessage" },
    // Command hooks: the interpreter, `"bash"` or `"powershell"`.
    { canonical: "shell", tool: "shell", commandOnly: true },
  ],
  // `once` is common to every handler type (honored in skill frontmatter only,
  // but accepted everywhere); `async` / `asyncRewake` are command-hook flags,
  // and `continueOnBlock` feeds a blocking hook's reason back to the model.
  // https://code.claude.com/docs/en/hooks
  booleanPassthroughFields: [
    { canonical: "once", tool: "once" },
    { canonical: "async", tool: "async", commandOnly: true },
    { canonical: "asyncRewake", tool: "asyncRewake", commandOnly: true },
    { canonical: "continueOnBlock", tool: "continueOnBlock" },
  ],
  // Command hooks: the exec form. With `args` present, `command` is resolved as
  // an executable and spawned directly, so no shell is involved and a path
  // never needs quoting.
  arrayPassthroughFields: [{ canonical: "args", tool: "args", commandOnly: true }],
};

export class ClaudecodeHooks extends ToolHooks {
  constructor(params: ToolHooksParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  /**
   * The converter config used for both directions. Exposed as a static hook so
   * plugin-scoped subclasses can swap tool-specific details (e.g. the project
   * directory variable) without duplicating the rest of the config.
   */
  static getConverterConfig(): ToolHooksConverterConfig {
    return CLAUDE_CONVERTER_CONFIG;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Currently, both global and project mode use the same paths.
    // The parameter is kept for consistency with other ToolHooks implementations.
    return { relativeDirPath: CLAUDECODE_DIR, relativeFilePath: CLAUDECODE_SETTINGS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<ClaudecodeHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static override supportsPreserveUnowned(): boolean {
    return true;
  }

  static override async getAuxiliaryFiles({
    toolHooks,
  }: {
    outputRoot?: string;
    global?: boolean;
    toolHooks?: ToolHooks;
    logger?: Logger;
  } = {}): Promise<ToolFile[]> {
    return toolHooks instanceof ClaudecodeHooks ? toolHooks.getOwnershipLockFiles() : [];
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
    preserveUnowned = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<ClaudecodeHooks> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    const config = rulesyncHooks.getJson();
    const claudeHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.claudecode?.hooks,
      converterConfig: this.getConverterConfig(),
      logger,
    });
    const preserving = preserveUnowned && this.supportsPreserveUnowned();
    const previouslyOwned = preserving
      ? parseHooksOwnershipLock(
          await readFileContentOrNull(
            join(outputRoot, paths.relativeDirPath, HOOKS_OWNERSHIP_LOCK_FILE_NAME),
          ),
        )
      : undefined;
    const merged = mergeGeneratedHookLists({
      existingContent,
      generatedHooks: claudeHooks,
      shape: "matcher-groups",
      preserveUnowned: preserving,
      previouslyOwned,
      logger,
    });
    const fileContent = applySharedConfigPatch({
      fileKey: CLAUDE_SETTINGS_SHARED_FILE_KEY,
      feature: "hooks",
      existingContent,
      patch: { hooks: merged.hooks },
      filePath,
    });
    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      ownedHookRefs: preserving ? merged.owned : undefined,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    let settings: { hooks?: unknown };
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Claude hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: settings.hooks,
      converterConfig: (this.constructor as typeof ClaudecodeHooks).getConverterConfig(),
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "claudecode" }),
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
  }: ToolHooksForDeletionParams): ClaudecodeHooks {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
