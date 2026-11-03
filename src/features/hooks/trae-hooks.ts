import { TRAE_DIR, TRAE_HOOKS_FILE_NAME } from "../../constants/trae-paths.js";
import {
  CANONICAL_TO_TRAE_EVENT_NAMES,
  TRAE_HOOK_EVENTS,
  TRAE_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import { invertToolNames, replaceMatcherNames } from "./hook-matcher-tool-names.js";
import { SettingsJsonHooks, type SettingsJsonHooksSpec } from "./settings-json-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

// TRAE documents `matcher` only on PreToolUse, PostToolUse and Notification;
// SessionStart, UserPromptSubmit and Stop carry none.
const TRAE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set([
  "sessionStart",
  "beforeSubmitPrompt",
  "stop",
]);

// TRAE's standardized tool names match Claude Code's (Read, Write, Edit, Glob,
// Grep, WebSearch, WebFetch, AskUserQuestion, Skill, `mcp__<server>__<tool>`)
// except for the terminal tool, which TRAE calls `RunCommand`.
const CANONICAL_TO_TRAE_TOOL_NAMES: Readonly<Record<string, string>> = { Bash: "RunCommand" };
const TRAE_TO_CANONICAL_TOOL_NAMES = invertToolNames(CANONICAL_TO_TRAE_TOOL_NAMES);

// Only `command` handlers exist, with `timeout` in seconds (the canonical
// unit). `$TRAE_PROJECT_DIR` is the documented workspace-root variable.
// The Stop-only group field `loop_limit` is not carried.
const TRAE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: TRAE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_TRAE_EVENT_NAMES,
  toolToCanonicalEventNames: TRAE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$TRAE_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: TRAE_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command"]),
  matcherTranslation: {
    toTool: ({ matcher }) => replaceMatcherNames(matcher, CANONICAL_TO_TRAE_TOOL_NAMES),
    toCanonical: (matcher) => replaceMatcherNames(matcher, TRAE_TO_CANONICAL_TOOL_NAMES),
  },
};

const TRAE_SPEC: SettingsJsonHooksSpec = {
  displayName: "TRAE",
  overrideKey: "trae",
  converterConfig: TRAE_CONVERTER_CONFIG,
};

/**
 * TRAE hooks.
 *
 * Hooks live under the top-level `hooks` key of the dedicated `.trae/hooks.json`
 * (project) and `~/.trae/hooks.json` (user scope). The IDE also writes a
 * `version` key there, so generation merges the `hooks` key into the file (see
 * `SHARED_CONFIG_OWNERSHIP`) instead of overwriting it.
 *
 * @see https://docs.trae.ai/ide/hook-configuration-reference?_lang=en
 */
export class TraeHooks extends SettingsJsonHooks {
  static override getSpec(): SettingsJsonHooksSpec {
    return TRAE_SPEC;
  }

  static override getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    // The processor supplies the home directory as outputRoot in global mode.
    return { relativeDirPath: TRAE_DIR, relativeFilePath: TRAE_HOOKS_FILE_NAME };
  }
}
