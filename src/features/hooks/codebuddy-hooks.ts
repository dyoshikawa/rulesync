import { CODEBUDDY_DIR, CODEBUDDY_SETTINGS_FILE_NAME } from "../../constants/codebuddy-paths.js";
import {
  CANONICAL_TO_CODEBUDDY_EVENT_NAMES,
  CODEBUDDY_HOOK_EVENTS,
  CODEBUDDY_NO_MATCHER_HOOK_EVENTS,
  CODEBUDDY_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { SettingsJsonHooks, type SettingsJsonHooksSpec } from "./settings-json-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

const CODEBUDDY_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set(CODEBUDDY_NO_MATCHER_HOOK_EVENTS);

// `$CODEBUDDY_PROJECT_DIR` is the documented project-root variable for hook
// commands, so dot-relative scripts are anchored to it the way Claude Code
// anchors them to `$CLAUDE_PROJECT_DIR`. `timeout` is in seconds (canonical
// unit). The hook reference and plugins reference document the `command`,
// `http`, `prompt` and `agent` types, and prompt hooks take an optional
// `continueOnBlock` flag.
const CODEBUDDY_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CODEBUDDY_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CODEBUDDY_EVENT_NAMES,
  toolToCanonicalEventNames: CODEBUDDY_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$CODEBUDDY_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: CODEBUDDY_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command", "http", "prompt", "agent"]),
  booleanPassthroughFields: [{ canonical: "continueOnBlock", tool: "continueOnBlock" }],
};

const CODEBUDDY_SPEC: SettingsJsonHooksSpec = {
  displayName: "CodeBuddy",
  overrideKey: "codebuddy",
  converterConfig: CODEBUDDY_CONVERTER_CONFIG,
};

/**
 * CodeBuddy Code hooks.
 *
 * Hooks live under the top-level `hooks` key of `.codebuddy/settings.json`
 * (project) and `~/.codebuddy/settings.json` (user), in the Claude-Code shape:
 * `{ "<Event>": [{ "matcher"?: "<regex>", "hooks": [{ "type": "command" |
 * "http" | "prompt" | "agent", ..., "timeout"?: <seconds> }] }] }`. Both files hold settings
 * rulesync does not own, so generation merges the `hooks` key into them (see
 * `SHARED_CONFIG_OWNERSHIP`) instead of overwriting them, and neither file is
 * removed wholesale.
 *
 * @see https://www.codebuddy.ai/docs/cli/hooks
 * @see https://www.codebuddy.ai/docs/cli/settings
 */
export class CodebuddyHooks extends SettingsJsonHooks {
  static override getSpec(): SettingsJsonHooksSpec {
    return CODEBUDDY_SPEC;
  }

  static override getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The same relative path is used for both scopes; the processor supplies
    // the home directory as outputRoot in global mode.
    return { relativeDirPath: CODEBUDDY_DIR, relativeFilePath: CODEBUDDY_SETTINGS_FILE_NAME };
  }
}
