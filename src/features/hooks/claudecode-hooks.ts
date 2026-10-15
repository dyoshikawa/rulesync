import { CLAUDECODE_DIR, CLAUDECODE_SETTINGS_FILE_NAME } from "../../constants/claudecode-paths.js";
import {
  CLAUDE_HOOK_EVENTS,
  CLAUDE_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_CLAUDE_EVENT_NAMES,
} from "../../types/hooks.js";
import { CLAUDE_SETTINGS_SHARED_FILE_KEY } from "../shared/shared-config-gateway.js";
import { SettingsJsonHooks, type SettingsJsonHooksSpec } from "./settings-json-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

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

/**
 * Events whose hooks ignore `onFailure`: exit code 2 there sends Claude back to
 * keep working, and Claude cannot repair a hook that will not run.
 * @see https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails
 */
const CLAUDE_ON_FAILURE_IGNORED_EVENTS: ReadonlySet<string> = new Set([
  "stop",
  "subagentStop",
  "taskCompleted",
  "teammateIdle",
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
  // Claude Code v2.1.295+ spells the canonical `failClosed` as
  // `onFailure: "block"` on `command` and `http` hooks, making a hook that
  // cannot start, errors, times out or returns invalid output act like exit
  // code 2. `"continue"` is the default, so `false` is omitted. The field has
  // no effect on Stop, SubagentStop, TaskCompleted and TeammateIdle hooks, so
  // a `true` there is dropped with a warning.
  // https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails
  keywordPassthroughFields: [
    {
      canonical: "failClosed",
      tool: "onFailure",
      trueValue: "block",
      falseValue: "continue",
      hookTypes: new Set(["command", "http"]),
      ignoredEvents: CLAUDE_ON_FAILURE_IGNORED_EVENTS,
    },
  ],
  // Command hooks: the exec form. With `args` present, `command` is resolved as
  // an executable and spawned directly, so no shell is involved and a path
  // never needs quoting.
  arrayPassthroughFields: [{ canonical: "args", tool: "args", commandOnly: true }],
};

const CLAUDE_SPEC: SettingsJsonHooksSpec = {
  displayName: "Claude",
  overrideKey: "claudecode",
  converterConfig: CLAUDE_CONVERTER_CONFIG,
};

export class ClaudecodeHooks extends SettingsJsonHooks {
  static override getSpec(): SettingsJsonHooksSpec {
    return CLAUDE_SPEC;
  }

  static override getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // Currently, both global and project mode use the same paths.
    // The parameter is kept for consistency with other ToolHooks implementations.
    return { relativeDirPath: CLAUDECODE_DIR, relativeFilePath: CLAUDECODE_SETTINGS_FILE_NAME };
  }

  /**
   * Every Claude-shaped settings file rulesync writes for Claude Code — the
   * project and user `settings.json` and the plugin bundle's `hooks.json` — is
   * declared under the one Claude key in `SHARED_CONFIG_OWNERSHIP`.
   */
  static override getSharedFileKey(_paths: ToolHooksSettablePaths): string {
    return CLAUDE_SETTINGS_SHARED_FILE_KEY;
  }

  static override supportsPreserveUnowned(): boolean {
    return true;
  }
}
