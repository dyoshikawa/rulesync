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
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { SettingsJsonHooks, type SettingsJsonHooksSpec } from "./settings-json-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

// Cortex Code documents `matcher` as a regex over the tool name (`*` is the
// documented match-all spelling); UserPromptSubmit and Stop fire on every
// occurrence and carry none.
// https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
const CORTEXCODE_NO_MATCHER_EVENTS: ReadonlySet<string> = new Set(["beforeSubmitPrompt", "stop"]);

// Cortex Code matches `matcher` case-sensitively against the runtime tool ID,
// and its built-in IDs are lowercase ("`bash` matches and `Bash` doesn't"),
// while canonical matchers use Claude Code's capitalized names. The tools page
// documents the lowercase IDs of these six; other built-ins (WebFetch,
// NotebookEdit, ...) have no documented ID, so they are left as written.
// https://docs.snowflake.com/en/user-guide/cortex-code/extensibility#hooks
// https://docs.snowflake.com/en/user-guide/cortex-code/tools
const CANONICAL_TO_CORTEXCODE_TOOL_NAMES: Readonly<Record<string, string>> = {
  Bash: "bash",
  Read: "read",
  Write: "write",
  Edit: "edit",
  Grep: "grep",
  Glob: "glob",
};
const CORTEXCODE_TO_CANONICAL_TOOL_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CORTEXCODE_TOOL_NAMES).map(([canonical, tool]) => [tool, canonical]),
);

// Splits a matcher regex into escapes (`\S`, `\b`), character classes
// (`[A-Z]`) and whole names. A name is not part of a longer identifier (so
// `mcp__srv__Read` is untouched) but may follow an escape, as in `\bRead\b`.
// Escapes and classes are matched first so their letters are never names.
const MATCHER_TOKEN_PATTERN = /\\.|\[(?:\\.|[^\]\\])*\]|(?<=^|[^\w\\]|\\\w)[A-Za-z_]\w*(?!\w)/gs;

function isMatcherName(token: string): boolean {
  return !token.startsWith("\\") && !token.startsWith("[");
}

function replaceMatcherNames(matcher: string, names: Readonly<Record<string, string>>): string {
  return matcher.replace(MATCHER_TOKEN_PATTERN, (token) =>
    isMatcherName(token) && Object.hasOwn(names, token) ? (names[token] ?? token) : token,
  );
}

export function canonicalToCortexcodeMatcher({
  matcher,
  eventName,
  warn,
}: {
  matcher: string;
  eventName: string;
  warn: (message: string) => void;
}): string {
  const translated = replaceMatcherNames(matcher, CANONICAL_TO_CORTEXCODE_TOOL_NAMES);
  const unmatched = [...translated.matchAll(MATCHER_TOKEN_PATTERN)]
    .map(([token]) => token)
    .filter((token) => isMatcherName(token) && /^[A-Z]/.test(token));
  if (unmatched.length > 0) {
    warn(
      `Cortex Code matches hook matchers case-sensitively against lowercase runtime tool names, ` +
        `and ${[...new Set(unmatched)].map((name) => quoteValueForWarning(name)).join(", ")} in the ` +
        `"${eventName}" matcher ${quoteValueForWarning(matcher)} is not a tool Cortex Code ` +
        `documents a runtime ID for, so it is written as-is and will likely never match. ` +
        `Replace it with the lowercase name Cortex Code uses for that tool, if it has one.`,
    );
  }
  return translated;
}

export function cortexcodeToCanonicalMatcher(matcher: string): string {
  return replaceMatcherNames(matcher, CORTEXCODE_TO_CANONICAL_TOOL_NAMES);
}

// `$CORTEX_PROJECT_DIR` is the documented project-root variable for hook
// commands, so dot-relative scripts are anchored to it the way Claude Code
// anchors them to `$CLAUDE_PROJECT_DIR`. `timeout` is in seconds (canonical
// unit) and the documented per-hook `enabled` flag round-trips as-is. The
// Remote Hooks `source` object (`{ source: "github:org/repo/path", ref }`)
// is documented on command hooks only, where `command` names the interpreter
// the fetched script runs under. `statusMessage` (the spinner text shown while
// the hook runs) is documented for command hooks on the Cortex Code Desktop
// hooks page, whose `~/.snowflake/cortex/hooks.json` is shared with the CLI.
// https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-desktop/hooks
const CORTEXCODE_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CORTEXCODE_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CORTEXCODE_EVENT_NAMES,
  toolToCanonicalEventNames: CORTEXCODE_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "$CORTEX_PROJECT_DIR",
  prefixDotRelativeCommandsOnly: true,
  noMatcherEvents: CORTEXCODE_NO_MATCHER_EVENTS,
  supportedHookTypes: new Set(["command", "prompt"]),
  booleanPassthroughFields: [{ canonical: "enabled", tool: "enabled" }],
  stringPassthroughFields: [
    { canonical: "statusMessage", tool: "statusMessage", commandOnly: true },
  ],
  objectPassthroughFields: [{ canonical: "source", tool: "source", commandOnly: true }],
  matcherTranslation: {
    toTool: canonicalToCortexcodeMatcher,
    toCanonical: cortexcodeToCanonicalMatcher,
  },
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
 * <seconds>, "enabled"?: <boolean>, "statusMessage"?: <string> (command only), "source"?: { "source", "ref"? } }] }] }`.
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
