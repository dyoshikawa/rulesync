import {
  OPENBITFUN_CONFIG_DIR_PATH,
  OPENBITFUN_HOOKS_FILE_NAME,
  openbitfunGlobalConfigDir,
} from "../../constants/openbitfun-paths.js";
import {
  CANONICAL_TO_OPENBITFUN_EVENT_NAMES,
  OPENBITFUN_HOOK_EVENTS,
  OPENBITFUN_TO_CANONICAL_EVENT_NAMES,
} from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import { warnOpenbitfunXdgOverride } from "../../utils/openbitfun.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import {
  buildCodexStyleHooksFile,
  CODEXCLI_CONVERTER_CONFIG,
  codexStyleHooksToRulesyncContent,
} from "./codexcli-hooks.js";
import {
  capitalizedMatcherNames,
  isMatcherName,
  MATCHER_TOKEN_PATTERN,
  replaceMatcherNames,
} from "./hook-matcher-tool-names.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

/**
 * Canonical (Claude Code) tool names whose OpenBitFun runtime name differs.
 * OpenBitFun's shell tool is `ExecCommand`; its own Claude-dialect skill hook
 * adapter maps `Bash` onto it, with the shell command in `tool_input.cmd`.
 * `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Skill` and
 * `LS` share their names, so they need no entry.
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/execution/agent-runtime/src/skills/hooks.rs
 */
const CANONICAL_TO_OPENBITFUN_TOOL_NAMES: Readonly<Record<string, string>> = {
  Bash: "ExecCommand",
};

const OPENBITFUN_TO_CANONICAL_TOOL_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CANONICAL_TO_OPENBITFUN_TOOL_NAMES).map(([canonical, tool]) => [tool, canonical]),
);

/**
 * OpenBitFun's built-in tool names (the default custom-agent tool sets in
 * `custom_agent.rs`, plus `LS`). Capitalized matcher names outside this set
 * are warned about on events that gate a tool call.
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/execution/agent-runtime/src/custom_agent.rs
 */
const OPENBITFUN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "Write",
  "Edit",
  "Delete",
  "ExecCommand",
  "WriteStdin",
  "ExecControl",
  "AgentSpawn",
  "AgentFork",
  "AgentSendInput",
  "AgentControl",
  "AgentList",
  "AgentWait",
  "ListModels",
  "Skill",
  "WebSearch",
  "WebFetch",
]);

/**
 * Events whose hooks can deny a tool call, so a matcher that never matches
 * makes the guard fail open. The keys are canonical names, or OpenBitFun's own
 * names when the hook comes from the `openbitfun.hooks` override block.
 */
const TOOL_GATING_EVENTS: ReadonlySet<string> = new Set([
  "preToolUse",
  "permissionRequest",
  "PreToolUse",
  "PermissionRequest",
]);

/**
 * Lowercased tool names mapped to the spelling OpenBitFun matches against:
 * its own built-in names, and the canonical names it renames (`bash` ->
 * `ExecCommand`).
 */
const KNOWN_TOOL_NAMES_BY_LOWERCASE: ReadonlyMap<string, string> = new Map([
  ...[...OPENBITFUN_TOOL_NAMES].map((name): [string, string] => [name.toLowerCase(), name]),
  ...Object.entries(CANONICAL_TO_OPENBITFUN_TOOL_NAMES).map(
    ([canonical, tool]): [string, string] => [canonical.toLowerCase(), tool],
  ),
]);

/**
 * An inline flag group that turns case-insensitive matching on: `(?i)`,
 * `(?is)`, `(?i:...)`, `(?xi-s)`. A group that only turns it off (`(?-i)`) or
 * names other flags (`(?s)`) does not.
 */
const CASE_INSENSITIVE_FLAG_PATTERN = /\(\?[a-zA-Z]*i[a-zA-Z]*(?:-[a-zA-Z]*)?[):]/;

/**
 * Lowercase whole names in a matcher that spell a known tool in another case
 * (`bash`, `read`). OpenBitFun compiles the matcher as a case-sensitive regex
 * anchored to the runtime tool name, so such a name never matches, unless an
 * inline flag group before it (`(?i)`, `(?i:...)`) makes the match
 * case-insensitive and the name is OpenBitFun's own spelling (`(?i)read`
 * matches `Read`, but `(?i)bash` still does not match `ExecCommand`).
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/execution/agent-runtime/src/native_hooks/settings.rs
 */
function wrongCaseToolNames(matcher: string): Array<{ name: string; tool: string }> {
  const flag = CASE_INSENSITIVE_FLAG_PATTERN.exec(matcher);
  const caseInsensitiveFrom = flag ? flag.index + flag[0].length : Number.POSITIVE_INFINITY;
  const found = new Map<string, string>();
  for (const match of matcher.matchAll(MATCHER_TOKEN_PATTERN)) {
    const [token] = match;
    if (!isMatcherName(token) || !/^[a-z]/.test(token)) continue;
    const tool = KNOWN_TOOL_NAMES_BY_LOWERCASE.get(token.toLowerCase());
    if (tool === undefined) continue;
    const caseInsensitive = match.index >= caseInsensitiveFrom;
    if (caseInsensitive && tool.toLowerCase() === token.toLowerCase()) continue;
    found.set(token, tool);
  }
  return [...found].map(([name, tool]) => ({ name, tool }));
}

function canonicalToOpenbitfunMatcher({
  matcher,
  eventName,
  warn,
}: {
  matcher: string;
  eventName: string;
  warn: (message: string) => void;
}): string {
  const translated = replaceMatcherNames(matcher, CANONICAL_TO_OPENBITFUN_TOOL_NAMES);
  if (TOOL_GATING_EVENTS.has(eventName)) {
    const unknown = capitalizedMatcherNames(translated).filter(
      (name) => !OPENBITFUN_TOOL_NAMES.has(name),
    );
    if (unknown.length > 0) {
      warn(
        `${unknown.map((name) => quoteValueForWarning(name)).join(", ")} in the "${eventName}" ` +
          `matcher ${quoteValueForWarning(matcher)} is not an OpenBitFun built-in tool, so it is ` +
          `written as-is and will likely never match there, and the hook will not run for that tool.`,
      );
    }
    const wrongCase = wrongCaseToolNames(translated);
    if (wrongCase.length > 0) {
      warn(
        `${wrongCase.map(({ name }) => quoteValueForWarning(name)).join(", ")} in the "${eventName}" ` +
          `matcher ${quoteValueForWarning(matcher)} never matches on OpenBitFun, which matches tool ` +
          `names case-sensitively against ${wrongCase.map(({ tool }) => quoteValueForWarning(tool)).join(", ")}, ` +
          `so the hook will not run for that tool. Spell the tool name as OpenBitFun does ` +
          `(the canonical "Bash" is translated to "ExecCommand").`,
      );
    }
  }
  return translated;
}

function openbitfunToCanonicalMatcher(matcher: string): string {
  return replaceMatcherNames(matcher, OPENBITFUN_TO_CANONICAL_TOOL_NAMES);
}

/**
 * Why OpenBitFun would skip a generated handler, or `undefined` when it runs
 * it. OpenBitFun's `parse_handler` treats a command handler whose `timeout` is
 * not a positive integer as invalid and skips that handler.
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/execution/agent-runtime/src/native_hooks/settings.rs
 */
function describeRejectedOpenbitfunHandler(handler: Record<string, unknown>): string | undefined {
  const { timeout } = handler;
  if (
    timeout !== undefined &&
    (typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout <= 0)
  ) {
    return `its "timeout" ${JSON.stringify(timeout) ?? String(timeout)} is not a positive integer, so OpenBitFun would skip it as invalid`;
  }
  return undefined;
}

/**
 * OpenBitFun implements the Codex hook contract: the same `hooks.json`
 * document, handler fields and matcher semantics (regexes anchored to the
 * whole tool name). It differs in the events it dispatches, in running only
 * `type: "command"` handlers (`prompt` and `agent` handlers are parsed but
 * skipped), in its runtime tool names (`ExecCommand` for `Bash`), and in the
 * handler fields it reads: `command`, `commandWindows`, `timeout` and
 * `statusMessage` only, so Codex's `async` and `additionalContextLimit` are
 * not forwarded.
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/docs/features/agent-hooks.md
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/src/crates/execution/agent-runtime/src/native_hooks/settings.rs
 */
export const OPENBITFUN_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  ...CODEXCLI_CONVERTER_CONFIG,
  supportedEvents: OPENBITFUN_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_OPENBITFUN_EVENT_NAMES,
  toolToCanonicalEventNames: OPENBITFUN_TO_CANONICAL_EVENT_NAMES,
  supportedHookTypes: new Set(["command"]),
  numberPassthroughFields: [],
  booleanPassthroughFields: [],
  matcherTranslation: {
    toTool: canonicalToOpenbitfunMatcher,
    toCanonical: openbitfunToCanonicalMatcher,
  },
};

/**
 * Hooks generator for OpenBitFun: a Codex-shaped `hooks.json` at
 * `.openbitfun/config/hooks.json` (project) and `<user root>/config/hooks.json`
 * (global; see {@link openbitfunGlobalConfigDir}). Both layers are additive.
 *
 * Project hooks are off by default in OpenBitFun: they only run once the
 * `app.hooks.project_hooks_enabled` setting is turned on.
 *
 * @see https://github.com/openBitFun/OpenBitFun/blob/main/docs/features/agent-hooks.md
 */
export class OpenbitfunHooks extends ToolHooks {
  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolHooksSettablePaths {
    return {
      relativeDirPath: global ? openbitfunGlobalConfigDir() : OPENBITFUN_CONFIG_DIR_PATH,
      relativeFilePath: OPENBITFUN_HOOKS_FILE_NAME,
    };
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
    preserveUnowned = false,
    logger,
  }: ToolHooksFromRulesyncHooksParams & {
    global?: boolean;
    logger?: Logger;
  }): Promise<OpenbitfunHooks> {
    if (global) {
      warnOpenbitfunXdgOverride({ kind: "config", logger });
    }
    const paths = OpenbitfunHooks.getSettablePaths({ global });
    const { fileContent, owned } = await buildCodexStyleHooksFile({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      rulesyncHooks,
      toolOverrideHooks: rulesyncHooks.getJson().openbitfun?.hooks,
      converterConfig: OPENBITFUN_CONVERTER_CONFIG,
      toolLabel: "OpenBitFun",
      describeRejected: describeRejectedOpenbitfunHandler,
      preserveUnowned,
      logger,
    });

    return new OpenbitfunHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      ownedHookRefs: preserveUnowned ? owned : undefined,
      validate,
    });
  }

  /**
   * `import --global` reads the same XDG-default location that generation
   * writes, so it warns about a moved user tree as well; otherwise the import
   * would silently find nothing there.
   */
  static override async fromFile(params: ToolHooksFromFileParams): Promise<ToolHooks> {
    if (params.global) {
      warnOpenbitfunXdgOverride({ kind: "config", logger: params.logger });
    }
    return super.fromFile(params);
  }

  toRulesyncHooks({ logger }: { logger?: Logger } = {}): RulesyncHooks {
    const parsed: { hooks?: unknown } = this.parseFileContentOrThrow({
      displayName: "OpenBitFun",
      parse: (fileContent) => JSON.parse(fileContent),
    });
    return this.toRulesyncHooksDefault({
      fileContent: codexStyleHooksToRulesyncContent({
        parsed,
        converterConfig: OPENBITFUN_CONVERTER_CONFIG,
        overrideKey: "openbitfun",
        logger,
      }),
    });
  }

  static override supportsPreserveUnowned(): boolean {
    return true;
  }
}
