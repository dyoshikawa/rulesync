import { CONTINUE_DIR, CONTINUE_SETTINGS_FILE_NAME } from "../../constants/continue-paths.js";
import {
  CANONICAL_TO_CONTINUE_EVENT_NAMES,
  CONTINUE_HOOK_EVENTS,
  CONTINUE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { SettingsJsonHooks, type SettingsJsonHooksSpec } from "./settings-json-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

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

const CONTINUE_SPEC: SettingsJsonHooksSpec = {
  displayName: "Continue",
  overrideKey: "continue",
  converterConfig: CONTINUE_CONVERTER_CONFIG,
};

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
export class ContinueHooks extends SettingsJsonHooks {
  static override getSpec(): SettingsJsonHooksSpec {
    return CONTINUE_SPEC;
  }

  static override getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The processor supplies the home directory as outputRoot in global mode;
    // the file layout is the same in both scopes.
    return { relativeDirPath: CONTINUE_DIR, relativeFilePath: CONTINUE_SETTINGS_FILE_NAME };
  }
}
