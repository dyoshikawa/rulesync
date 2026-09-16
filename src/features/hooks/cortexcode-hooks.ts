import {
  CORTEXCODE_DIR,
  CORTEXCODE_GLOBAL_DIR_PATH,
  CORTEXCODE_GLOBAL_HOOKS_FILE_NAME,
  CORTEXCODE_SETTINGS_FILE_NAME,
} from "../../constants/cortexcode-paths.js";
import {
  CANONICAL_TO_CORTEXCODE_EVENT_NAMES,
  CORTEXCODE_HOOK_EVENTS,
  CORTEXCODE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { SettingsJsonHooks, type SettingsJsonHooksSpec } from "./settings-json-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

// Cortex Code documents `matcher` as a regex over the tool name (`*` is the
// documented match-all spelling); UserPromptSubmit and Stop fire on every
// occurrence and carry none.
// https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
const CORTEXCODE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set(["beforeSubmitPrompt", "stop"]);

// `$CORTEX_PROJECT_DIR` is the documented project-root variable for hook
// commands, so dot-relative scripts are anchored to it the way Claude Code
// anchors them to `$CLAUDE_PROJECT_DIR`. `timeout` is in seconds (canonical
// unit) and the documented per-hook `enabled` flag round-trips as-is. The
// Remote Hooks `source` object (`{ source: "github:org/repo/path", ref }`)
// is documented on command hooks only, where `command` names the interpreter
// the fetched script runs under.
const CORTEXCODE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CORTEXCODE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CORTEXCODE_EVENT_NAMES,
  toolToCanonicalEventNames: CORTEXCODE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$CORTEX_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: CORTEXCODE_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command", "prompt"]),
  booleanPassthroughFields: [{ canonical: "enabled", tool: "enabled" }],
  objectPassthroughFields: [{ canonical: "source", tool: "source", commandOnly: true }],
};

const CORTEXCODE_SPEC: SettingsJsonHooksSpec = {
  displayName: "Cortex Code",
  overrideKey: "cortexcode",
  converterConfig: CORTEXCODE_CONVERTER_CONFIG,
};

/**
 * Snowflake Cortex Code hooks.
 *
 * Hooks live under the top-level `hooks` key of `<project>/.cortex/settings.json`
 * (project scope) and of the dedicated `~/.snowflake/cortex/hooks.json` (user
 * scope), both in the Claude-Code shape: `{ "<Event>": [{ "matcher"?:
 * "<regex>", "hooks": [{ "type": "command" | "prompt", ..., "timeout"?:
 * <seconds>, "enabled"?: <boolean>, "source"?: { "source", "ref"? } }] }] }`.
 * The project file also holds settings rulesync does not own, so generation
 * merges the `hooks` key into
 * either file (see `SHARED_CONFIG_OWNERSHIP`) instead of overwriting it, and
 * neither file is removed wholesale (hooks.json sits in the CLI-owned
 * `~/.snowflake/cortex/` tree).
 *
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/settings
 */
export class CortexcodeHooks extends SettingsJsonHooks {
  static override getSpec(): SettingsJsonHooksSpec {
    return CORTEXCODE_SPEC;
  }

  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolHooksSettablePaths {
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
}
