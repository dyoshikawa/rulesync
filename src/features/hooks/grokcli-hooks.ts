import { join } from "node:path";

import { GROKCLI_HOOKS_DIR_PATH, GROKCLI_HOOKS_FILE_NAME } from "../../constants/grokcli-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CANONICAL_TO_GROKCLI_EVENT_NAMES,
  GROKCLI_HOOK_EVENTS,
  GROKCLI_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
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

/**
 * Grok CLI hook events that have no `matcher` field.
 *
 * Grok tests `matcher` (a regex) against the tool name — verbatim: "matcher is
 * a regular expression tested against the tool name … omit it to match
 * everything." The docs don't enumerate matcher support per event, but since
 * Grok is Claude-Code-compatible (it also reads `.claude/settings.json`), a
 * matcher is only meaningful on the events that carry a tool name in their
 * context: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and
 * `PermissionDenied`. The remaining session/turn/notification/subagent/
 * compaction events are matcher-less; any matcher defined on them is dropped
 * with a warning during export (mirroring `CLAUDE_NO_MATCHER_EVENTS`).
 * @see https://docs.x.ai/build/features/hooks
 */
const GROKCLI_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "stop",
  "stopFailure",
  "notification",
  "subagentStart",
  "subagentStop",
  "preCompact",
  "postCompact",
]);

const GROKCLI_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: GROKCLI_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_GROKCLI_EVENT_NAMES,
  toolToCanonicalEventNames: GROKCLI_TO_CANONICAL_EVENT_NAMES,
  // Grok documents plain shell commands with no project-directory variable, so
  // commands are emitted verbatim.
  projectDirVar: "",
  // Grok natively supports `command` and `http` hook types (not `prompt`).
  // Grok's `HookHandlerType` is `command | http` (an http handler POSTs to
  // `url`), and the shared converter round-trips both — Claude Code has
  // declared `http` here for a while. Declaring exactly these two keeps the
  // other canonical types from leaking through as entries Grok cannot read.
  // https://docs.x.ai/build/features/hooks
  supportedHookTypes: new Set(["command", "http"]),
  // `env` supplies extra environment variables for the hook process. Upstream
  // it is `HookConfig.env: HashMap<String, String>` ("Extra env vars, merged
  // into HookSpec::extra_env") in `crates/codegen/xai-grok-hooks/src/config.rs`,
  // and it is merged into the spawned command's environment — so it is emitted
  // on `command` hooks only, matching how Qwen Code gates the same field.
  recordPassthroughFields: [{ canonical: "env", tool: "env", commandOnly: true }],
  noMatcherEvents: GROKCLI_NO_MATCHER_EVENTS,
};

/**
 * Hooks generator for Grok CLI (xAI Grok Build).
 *
 * Grok Build adopts a Claude-Code-compatible lifecycle hooks model: each event
 * maps to an array of `{ matcher?, hooks: [{ type, command, timeout? }] }`
 * matcher groups under a top-level `hooks` key. rulesync writes all its hooks
 * into a single standalone `rulesync.json` file discovered from
 * `.grok/hooks/*.json` (project) and `~/.grok/hooks/*.json` (global). The file
 * is dedicated to hooks and owned wholesale by rulesync, so it may be deleted
 * as an orphan.
 *
 * @see https://docs.x.ai/build/features/hooks
 */
export class GrokcliHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Grok resolves project vs global scope by the directory it runs in, so both
    // scopes share the same relative layout (`.grok/hooks/rulesync.json`).
    return {
      relativeDirPath: GROKCLI_HOOKS_DIR_PATH,
      relativeFilePath: GROKCLI_HOOKS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<GrokcliHooks> {
    const paths = GrokcliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new GrokcliHooks({
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
  }): Promise<GrokcliHooks> {
    const paths = GrokcliHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const grokHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.grokcli?.hooks,
      converterConfig: GROKCLI_CONVERTER_CONFIG,
      logger,
    });
    // The standalone rulesync.json is dedicated to hooks, so any existing
    // content is fully replaced; the write happens later in `writeAiFiles`.
    const fileContent = JSON.stringify({ hooks: grokHooks }, null, 2);
    return new GrokcliHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Grok hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }
    const events = isRecord(parsed) && isRecord(parsed.hooks) ? parsed.hooks : {};
    const hooks = toolHooksToCanonical({
      hooks: events,
      converterConfig: GROKCLI_CONVERTER_CONFIG,
      logger,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify(
        buildImportedHooksConfig({ hooks, overrideKey: "grokcli" }),
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
  }: ToolHooksForDeletionParams): GrokcliHooks {
    return new GrokcliHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }
}
