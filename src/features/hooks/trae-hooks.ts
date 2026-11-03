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
// unit). TRAE runs hooks from the project root and uses PowerShell on Windows,
// so commands are written as-is; the documented `$TRAE_PROJECT_DIR` and its
// `$CLAUDE_PROJECT_DIR` alias are only stripped on import. `loop_limit` (the
// most times a Stop group may block the agent) is a matcher-group field
// documented on Stop only; hooks with different limits get separate groups.
const TRAE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: TRAE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_TRAE_EVENT_NAMES,
  toolToCanonicalEventNames: TRAE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$TRAE_PROJECT_DIR",
  stripsProjectDirVarOnImportOnly: true,
  importedProjectDirVarAliases: ["$CLAUDE_PROJECT_DIR"],
  noMatcherEvents: TRAE_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command"]),
  groupPassthroughFields: [
    {
      canonical: "loop_limit",
      tool: "loop_limit",
      valueType: "number",
      events: new Set(["stop"]),
      subdividesGroup: true,
      // TRAE falls back to its default of 5 when the limit is missing.
      onInvalidImport: "drop-field",
    },
  ],
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
