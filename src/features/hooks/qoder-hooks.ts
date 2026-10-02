import { QODER_DIR, QODER_SETTINGS_FILE_NAME } from "../../constants/qoder-paths.js";
import {
  CANONICAL_TO_QODER_EVENT_NAMES,
  QODER_HOOK_EVENTS,
  QODER_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { SettingsJsonHooks, type SettingsJsonHooksSpec } from "./settings-json-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

// Events the Qoder Event Reference documents without a matcher. TaskCreated,
// TaskCompleted and TeammateIdle are listed by name only, so they follow
// Claude Code, whose event set Qoder mirrors.
// https://docs.qoder.com/en/cli/hooks
const QODER_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "beforeSubmitPrompt",
  "stop",
  "cwdChanged",
  "worktreeCreate",
  "worktreeRemove",
  "taskCreated",
  "taskCompleted",
  "teammateIdle",
]);

const QODER_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: QODER_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_QODER_EVENT_NAMES,
  toolToCanonicalEventNames: QODER_TO_CANONICAL_EVENT_NAMES,
  // `QODER_PROJECT_DIR` is exported into every hook subprocess.
  projectDirVar: "$QODER_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: QODER_NO_MATCHER_EVENTS,
  // Qoder documents the `command`, `http`, `prompt` and `agent` handler types
  // (no `mcp_tool`); prompt and agent hooks take an optional `model`.
  supportedHookTypes: new Set(["command", "http", "prompt", "agent"]),
  emitsPromptModel: true,
  stringPassthroughFields: [
    // The conditional filter (`"ToolName"` / `"ToolName(arg_pattern)"`).
    { canonical: "if", tool: "if" },
    // The spinner / status-line label shown while the hook runs.
    { canonical: "statusMessage", tool: "statusMessage" },
    // Command hooks: the interpreter, `"bash"` or `"powershell"`.
    { canonical: "shell", tool: "shell", commandOnly: true },
  ],
  booleanPassthroughFields: [
    { canonical: "once", tool: "once" },
    { canonical: "async", tool: "async", commandOnly: true },
    { canonical: "asyncRewake", tool: "asyncRewake", commandOnly: true },
  ],
  // Command hooks: the exec form (an argv array; no shell is involved).
  arrayPassthroughFields: [{ canonical: "args", tool: "args", commandOnly: true }],
  // Command hooks: extra environment variables merged into the subprocess.
  recordPassthroughFields: [{ canonical: "env", tool: "env", commandOnly: true }],
};

const QODER_SPEC: SettingsJsonHooksSpec = {
  displayName: "Qoder",
  overrideKey: "qoder",
  converterConfig: QODER_CONVERTER_CONFIG,
};

/**
 * Qoder lifecycle hooks.
 *
 * Hooks live under the top-level `hooks` key of `.qoder/settings.json`
 * (project) and `~/.qoder/settings.json` (user) in the Claude-Code shape:
 * `{ "<Event>": [{ "matcher"?: "...", "hooks": [{ "type": "command",
 * "command": "...", "timeout"?: <seconds> }] }] }`. Qoder also merges
 * `.qoder/settings.local.json`, which rulesync leaves to the user. The file
 * holds settings rulesync does not own, so generation merges the `hooks` key
 * into it (see `SHARED_CONFIG_OWNERSHIP`) instead of overwriting the file.
 *
 * @see https://docs.qoder.com/en/cli/hooks
 * @see https://docs.qoder.com/en/cli/hooks-reference
 */
export class QoderHooks extends SettingsJsonHooks {
  static override getSpec(): SettingsJsonHooksSpec {
    return QODER_SPEC;
  }

  static override getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The user file mirrors the project one under the home directory, which
    // the processor supplies as outputRoot in global mode.
    return { relativeDirPath: QODER_DIR, relativeFilePath: QODER_SETTINGS_FILE_NAME };
  }
}
