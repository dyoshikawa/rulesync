import {
  BOB_DIR,
  BOB_GLOBAL_SETTINGS_DIR_PATH,
  BOB_SETTINGS_FILE_NAME,
} from "../../constants/bob-paths.js";
import {
  BOB_HOOK_EVENTS,
  BOB_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_BOB_EVENT_NAMES,
} from "../../types/hooks.js";
import { SettingsJsonHooks, type SettingsJsonHooksSpec } from "./settings-json-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

// Bob honours `matcher` (a regex) on PreToolUse / PostToolUse (tool name),
// SessionStart (`source`: startup | resume | compact) and PreCompact /
// PostCompact (`trigger`: manual | auto); UserPromptSubmit and Stop ignore it.
// https://bob.ibm.com/docs/shell/configuration/lifecycle-hooks
// https://bob.ibm.com/docs/ide/configuration/lifecycle-hooks
const BOB_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set(["beforeSubmitPrompt", "stop"]);

// `projectDirVar` is empty: Bob documents no inline project-directory
// substitution for hook commands, so commands are emitted verbatim.
// `wildcardMatcherMeansAll`: Bob compiles `matcher` as a regex and treats an
// omitted matcher as match-all, so the canonical catch-all `"*"` (not a valid
// regex) is emitted as no matcher instead of verbatim.
// `importedHookTypeAliases`: Bob's webhook handler is `type: "http"` (both
// lifecycle-hooks pages); Bob Shell 2.0.3 documented it as `https`, which
// earlier rulesync releases wrote, so that spelling still imports as `http`.
const BOB_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: BOB_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_BOB_EVENT_NAMES,
  toolToCanonicalEventNames: BOB_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  noMatcherEvents: BOB_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command", "http"]),
  importedHookTypeAliases: { https: "http" },
  wildcardMatcherMeansAll: true,
};

const BOB_SPEC: SettingsJsonHooksSpec = {
  displayName: "Bob",
  overrideKey: "bob",
  converterConfig: BOB_CONVERTER_CONFIG,
};

/**
 * IBM Bob lifecycle hooks.
 *
 * Hooks live under the top-level `hooks` key of Bob's settings file —
 * `<project>/.bob/settings.json` (project scope) and
 * `~/.bob/settings/settings.json` (user scope) — in the Claude-Code shape:
 * `{ "<Event>": [{ "matcher"?: "<regex>", "hooks": [{ "type": "command",
 * "command": "...", "timeout"?: <seconds> }] }] }`, where a handler may
 * instead be `{ "type": "http", "url": "https://...", "timeout"?: <seconds> }`. The
 * file also holds settings rulesync does not own, so generation merges the
 * `hooks` key into it (see `SHARED_CONFIG_OWNERSHIP`) instead of overwriting
 * the file.
 *
 * @see https://bob.ibm.com/docs/shell/configuration/lifecycle-hooks
 * @see https://bob.ibm.com/docs/ide/configuration/lifecycle-hooks
 */
export class BobHooks extends SettingsJsonHooks {
  static override getSpec(): SettingsJsonHooksSpec {
    return BOB_SPEC;
  }

  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The user file sits one directory deeper than the project file; the
    // processor supplies the home directory as outputRoot in global mode.
    return {
      relativeDirPath: global ? BOB_GLOBAL_SETTINGS_DIR_PATH : BOB_DIR,
      relativeFilePath: BOB_SETTINGS_FILE_NAME,
    };
  }
}
