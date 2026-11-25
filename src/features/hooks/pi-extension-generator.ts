import { HooksConfig } from "../../types/hooks.js";
import { buildBlockReasonSanitizerLines } from "./hook-block-reason.js";
import { sanitizeMatcherRegex } from "./hook-matcher-regex.js";
import { hookTimingOf } from "./opencode-style-generator.js";

/**
 * Pi extension events fired per tool invocation; handlers for these receive
 * `event.toolName` and honor the canonical hook `matcher` as a regex on it.
 */
const PI_TOOL_EVENTS = new Set(["tool_call", "tool_result"]);

/**
 * Pi extension events that fire for every message role (user, assistant,
 * toolResult). The generated handler gates these on the assistant role so a
 * `postModelInvocation` hook runs once per finalized model response rather
 * than for every message in the conversation.
 */
const PI_ASSISTANT_MESSAGE_EVENTS = new Set(["message_end"]);

/**
 * Canonical events whose Pi event also fires when nothing went wrong. Pi's
 * `tool_result` fires for every finished tool call and exposes `event.isError`,
 * so a `postToolUseFailure` handler is gated on that flag while a `postToolUse`
 * handler on the same Pi event runs regardless.
 *
 * @see https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md#tool_result
 */
const PI_ERROR_GATED_CANONICAL_EVENTS = new Set(["postToolUseFailure"]);

/**
 * `tool_call` is Pi's tool gate. Its return contract is
 * `{ block: true, reason?: string, terminate?: boolean }`.
 *
 * @see https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/extensions.md#tool_call
 */
const PI_BLOCKING_EVENT = "tool_call";

/**
 * `input` is Pi's prompt-submission gate. A handler that returns
 * `{ action: "handled" }` skips the agent entirely for that prompt (the first
 * handler returning it wins), which is how a canonical `beforeSubmitPrompt`
 * hook cancels a prompt on the other hook-capable targets. `handled` carries
 * no reason field, so the failure text is reported through the extension
 * context instead.
 *
 * @see https://github.com/earendil-works/pi/blob/v0.84.3/packages/coding-agent/docs/extensions.md#input
 */
const PI_PROMPT_BLOCKING_EVENT = "input";

/**
 * `agent_before_settle` (Pi v0.87.0+) is the last actionable boundary before a
 * run settles. Returning `{ entries, continue: true }` persists the entries and
 * runs one more model request, which is how a canonical `stop` hook keeps the
 * agent going. Like Claude Code's `Stop`, only exit code 2 asks for that; any
 * other failure (including a command that could not be run) never continues
 * the agent, since the safe side of a stop hook is to let the agent stop rather
 * than to pay for an extra model request; it is rethrown after every stop
 * command has run, so Pi reports it as an extension error. The feedback of all
 * commands exiting with 2 is combined into one request. Pi warns
 * that an unconditional continuation loops, so the generated extension
 * continues at most once per settled run and resets that guard on
 * `agent_settled`, which Pi fires exactly once when the run is final.
 *
 * @see https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/extensions/types.ts
 */
const PI_SETTLE_BLOCKING_EVENT = "agent_before_settle";

/**
 * `session_stop` is oh-my-pi's stop surface (it has no `agent_before_settle`).
 * It fires when a main-session run is about to settle (never for subagents,
 * nor for a run the user aborted), and a handler returning
 * `{ continue: true, additionalContext }` queues one more turn with that text
 * as hidden model-visible context. As on Pi, only a stop command exiting with
 * code 2 asks for that, the feedback of every such command is combined, and
 * any other failure is rethrown for oh-my-pi to report. The generated handler
 * continues only when `event.stop_hook_active` is false, which oh-my-pi sets
 * after a continuation and clears once a stop pass lets the run settle, so the
 * agent is continued at most once per stop (the flag is shared by every
 * extension, so another extension's continuation also suppresses ours);
 * oh-my-pi additionally caps these
 * advisory continuations at 8 in a row. A run that ended on a provider error
 * (`stopReason: "error"`) is not continued, matching Pi's `completed`-only
 * gate. The advisory form is used rather than `{ decision: "block", reason }`,
 * which oh-my-pi keeps enforcing without that cap. oh-my-pi gives
 * `session_stop` handlers the 30-second extension handler budget: stop
 * commands running longer time the handler out, the run settles without a
 * continuation, and the command is not killed.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/fa5ff4a3a977a28b93d025f4cf50f046e019f18c/docs/extensions.md
 * @see https://github.com/can1357/oh-my-pi/blob/fa5ff4a3a977a28b93d025f4cf50f046e019f18c/packages/coding-agent/src/session/agent-session.ts
 */
const OMP_SESSION_STOP_BLOCKING_EVENT = "session_stop";

/**
 * What differs between the extension APIs of Pi and its fork oh-my-pi
 * (`omp`). Both load a default-export factory and share the event names this
 * generator emits, but they publish their types from different packages and
 * oh-my-pi's `input` gate answers `{ handled?: boolean }` rather than Pi's
 * `{ action: "continue" | "handled" }`.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/40e9368ef0458fd9073329cdff4174895f91bc6b/packages/coding-agent/src/extensibility/extensions/types.ts
 */
type PiExtensionDialect = {
  /** Tool-scoped override block in `hooks.json` merged over the shared hooks. */
  overrideKey: "pi" | "omp";
  /** Package the generated module imports `ExtensionAPI` and friends from. */
  typesPackage: string;
  /** Statement that lets a prompt through the `input` gate. */
  promptPassLine: string;
  /** Statement that cancels a prompt at the `input` gate. */
  promptCancelLine: string;
  /** Built-in tool names mapped to the canonical Claude Code names. */
  toolNames: Readonly<Record<string, string>>;
};

/**
 * Tool names both Pi and oh-my-pi share with a canonical counterpart. Pi's
 * `powershell` tool is deliberately left out: Rulesync has no canonical name
 * for it, so it keeps its own.
 */
const SHARED_CANONICAL_TOOL_NAMES = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
} as const;

const PI_EXTENSION_DIALECT: PiExtensionDialect = {
  overrideKey: "pi",
  typesPackage: "@earendil-works/pi-coding-agent",
  promptPassLine: 'return { action: "continue" };',
  promptCancelLine: 'return { action: "handled" };',
  // Pi's `find` takes a glob `pattern`, like Claude Code's `Glob`.
  toolNames: { ...SHARED_CANONICAL_TOOL_NAMES, find: "Glob" },
};

/**
 * oh-my-pi's `emitInput` stops at the first result with `handled` set and
 * treats any other result without `text` / `images` as a pass.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/40e9368ef0458fd9073329cdff4174895f91bc6b/packages/coding-agent/src/extensibility/extensions/runner.ts
 */
export const OMP_EXTENSION_DIALECT: PiExtensionDialect = {
  overrideKey: "omp",
  typesPackage: "@oh-my-pi/pi-coding-agent",
  promptPassLine: "return {};",
  promptCancelLine: "return { handled: true };",
  // oh-my-pi's glob tool is `glob`; its `find` is a different (search) tool,
  // so it is not mapped.
  toolNames: { ...SHARED_CANONICAL_TOOL_NAMES, glob: "Glob" },
};

/**
 * How a generated handler reacts to a hook command that exits non-zero. The
 * `settle` gate reacts to exit code 2 only; see `PI_SETTLE_BLOCKING_EVENT`.
 */
type BlockingMode = "none" | "tool" | "prompt" | "settle" | "sessionStop";

const PI_BLOCKING_MODE_BY_EVENT: Record<string, BlockingMode> = {
  [PI_BLOCKING_EVENT]: "tool",
  [PI_PROMPT_BLOCKING_EVENT]: "prompt",
  [PI_SETTLE_BLOCKING_EVENT]: "settle",
  [OMP_SESSION_STOP_BLOCKING_EVENT]: "sessionStop",
};

/**
 * The body emitted inside a blocking handler's `catch`, per gate. `tool_call`
 * carries the reason in its own return contract; `input` has no reason field,
 * so the reason is reported through the context before the prompt is
 * cancelled.
 */
function failureLinesByMode(dialect: PiExtensionDialect): Record<BlockingMode, readonly string[]> {
  return {
    none: [],
    // `terminate` is deliberately left unset: a denied tool call should hand
    // control back to the model (as Claude Code's `PreToolUse` deny does)
    // rather than end the agent turn.
    tool: ["return { block: true, reason: toBlockReason(error) };"],
    prompt: ["reportPromptGateFailure(ctx, toBlockReason(error));", dialect.promptCancelLine],
    // Feedback is only collected here; the handler decides after every stop
    // command has run (see `buildSubscriptionLines`).
    settle: ["stopHookFailures.push(error);"],
    sessionStop: ["stopHookFailures.push(error);"],
  };
}

/**
 * Canonical events whose command receives Claude Code's JSON input for the
 * event on stdin, mapped to its `hook_event_name`; every other command gets an
 * empty stdin, as in the OpenCode-style plugin (`STDIN_PAYLOADS` in
 * `opencode-style-generator.ts`). All three ride on Pi's tool events, whose
 * `event.toolName`, `event.toolCallId` and `event.input` the payload is built
 * from. A payload is serialized lazily, once per invocation, by the first
 * handler that runs.
 *
 * @see https://github.com/earendil-works/pi/blob/v1.6.0/packages/coding-agent/docs/extensions.md#tool_call
 * @see https://code.claude.com/docs/en/hooks
 */
const STDIN_PAYLOAD_EVENTS: Record<string, string> = {
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
};

/**
 * The fields each payload adds to the tool call's own (`session_id`, `cwd`,
 * `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`), as TypeScript
 * object entries evaluated against the `tool_result` event.
 */
const STDIN_PAYLOAD_EXTRA_FIELDS: Record<string, string> = {
  PreToolUse: "",
  PostToolUse: "tool_response: { content: event.content, details: event.details }",
  PostToolUseFailure: "error: toolResultText(event.content)",
};

/**
 * Helpers emitted when a handler receives a stdin payload or tests a matcher.
 *
 * `claudeToolName` maps the dialect's built-in tool names to the canonical
 * Claude Code names Rulesync uses elsewhere (`bash` → `Bash`, ...). MCP tools
 * are already named `mcp__<server>__<tool>` by Pi, and other tools keep their
 * own name.
 *
 * `claudeToolInput` passes the tool's arguments through, except for the file
 * tools: `path` becomes Claude Code's absolute `file_path`, resolved against
 * the session cwd the way Pi resolves it (a leading `@` stripped, `~`
 * expanded), and each `edits` entry's `oldText` / `newText` becomes
 * `old_string` / `new_string`, with every edit's text also joined into the
 * top-level `old_string` / `new_string` Claude Code's `Edit` input carries, so
 * a guard reading those sees every change. The mapped keys are written last
 * and any same-named key the model added is dropped, so an extra argument
 * (Pi's schemas allow them) cannot make a guard check a different file or
 * text than the one the tool acts on.
 */
function buildToolPayloadHelperLines(dialect: PiExtensionDialect): string[] {
  return [
    `const CLAUDE_TOOL_NAMES: Record<string, string> = ${JSON.stringify(dialect.toolNames)};`,
    "",
    "function claudeToolName(toolName: string): string {",
    "  return Object.hasOwn(CLAUDE_TOOL_NAMES, toolName) ? (CLAUDE_TOOL_NAMES[toolName] ?? toolName) : toolName;",
    "}",
    "",
    "function matchesTool(matcher: RegExp, toolName: string): boolean {",
    "  return matcher.test(toolName) || matcher.test(claudeToolName(toolName));",
    "}",
    "",
    "function absoluteToolPath(path: unknown, cwd: string): unknown {",
    '  if (typeof path !== "string") return path;',
    '  const bare = path.startsWith("@") ? path.slice(1) : path;',
    '  const expanded = bare === "~" || bare.startsWith("~/") ? homedir() + bare.slice(1) : bare;',
    "  return resolvePath(cwd, expanded);",
    "}",
    "",
    "function claudeToolInput(toolName: string, input: unknown, cwd: string): unknown {",
    '  if (!["read", "write", "edit"].includes(toolName)) return input;',
    '  if (!input || typeof input !== "object" || Array.isArray(input)) return input;',
    "  const {",
    "    path,",
    "    edits,",
    "    file_path: _filePath,",
    "    old_string: _oldString,",
    "    new_string: _newString,",
    "    ...rest",
    "  } = input as Record<string, unknown>;",
    "  const claudeInput: Record<string, unknown> = { ...rest, file_path: absoluteToolPath(path, cwd) };",
    "  if (!Array.isArray(edits)) {",
    "    if (edits !== undefined) claudeInput.edits = edits;",
    "    return claudeInput;",
    "  }",
    "  const claudeEdits = edits.map((edit: unknown) => {",
    '    if (!edit || typeof edit !== "object") return edit;',
    "    const {",
    "      oldText,",
    "      newText,",
    "      old_string: _old,",
    "      new_string: _new,",
    "      ...others",
    "    } = edit as Record<string, unknown>;",
    "    return { ...others, old_string: oldText, new_string: newText };",
    "  });",
    "  const joined = (key: string) =>",
    "    claudeEdits",
    "      .map((edit: unknown) => (edit as Record<string, unknown> | null)?.[key])",
    '      .filter((text): text is string => typeof text === "string")',
    '      .join("\\n");',
    '  return { ...claudeInput, edits: claudeEdits, old_string: joined("old_string"), new_string: joined("new_string") };',
    "}",
    "",
    "function toolResultText(content: unknown): string {",
    '  if (!Array.isArray(content)) return "";',
    "  return content",
    "    .map((block: unknown) => {",
    "      const part = block as { type?: unknown; text?: unknown } | null;",
    '      return part?.type === "text" && typeof part.text === "string" ? part.text : "";',
    "    })",
    "    .filter(Boolean)",
    '    .join("\\n");',
    "}",
    "",
    "type ToolHookEvent = { toolName: string; toolCallId?: string; input?: unknown };",
    "",
    "function toolHookInput(",
    "  hookEventName: string,",
    "  event: ToolHookEvent,",
    "  ctx: ExtensionContext | undefined,",
    "  extra: Record<string, unknown> = {},",
    "): string {",
    "  const cwd = ctx?.cwd ?? process.cwd();",
    "  return JSON.stringify({",
    "    session_id: ctx?.sessionManager?.getSessionId?.(),",
    "    cwd,",
    "    hook_event_name: hookEventName,",
    "    tool_name: claudeToolName(event.toolName),",
    "    tool_input: claudeToolInput(event.toolName, event.input, cwd),",
    "    tool_use_id: event.toolCallId,",
    "    ...extra,",
    "  });",
    "}",
  ];
}

/**
 * Helpers emitted alongside `tool_call` handlers. A command that exits 0 may
 * still decide the call the way Claude Code reads a `PreToolUse` hook's JSON
 * stdout: `hookSpecificOutput.permissionDecision` `"deny"` or `"ask"` (with
 * `permissionDecisionReason`) or, when no `permissionDecision` is given, the
 * deprecated top-level `decision: "block"` (with `reason`). Output that is not
 * such JSON allows the call, so hooks that print plain text keep working. The
 * deny side is the OpenCode-style plugin's `__rulesyncEnforcePreToolUseResult`
 * contract, plus the deprecated form Claude Code still honors.
 *
 * Pi has no permission prompt of its own, so `"ask"` is put to the user with
 * `ctx.ui.confirm` when a UI is attached, and denies the call when none is (print
 * and JSON modes) or the dialog fails: a hook asking for a human must not pass
 * silently.
 */
const TOOL_DECISION_HELPER_LINES = [
  'type ToolHookDecision = { kind: "deny" | "ask"; reason: string };',
  "",
  "function toolHookDecision(stdout: string): ToolHookDecision | undefined {",
  "  let parsed: unknown;",
  "  try {",
  "    parsed = JSON.parse(stdout);",
  "  } catch {",
  "    return undefined;",
  "  }",
  '  if (!parsed || typeof parsed !== "object") return undefined;',
  "  const output = parsed as { decision?: unknown; reason?: unknown; hookSpecificOutput?: unknown };",
  "  const specific = output.hookSpecificOutput as",
  "    | { permissionDecision?: unknown; permissionDecisionReason?: unknown }",
  "    | null",
  "    | undefined;",
  '  const hasDecision = typeof specific === "object" && specific !== null && specific.permissionDecision !== undefined;',
  '  const decision = hasDecision ? specific?.permissionDecision : output.decision === "block" ? "deny" : undefined;',
  '  if (decision !== "deny" && decision !== "ask") return undefined;',
  "  const reason = hasDecision ? specific?.permissionDecisionReason : output.reason;",
  "  return {",
  "    kind: decision,",
  "    reason:",
  '      (typeof reason === "string" && sanitizeBlockReason(reason)) ||',
  '      (decision === "ask" ? "A preToolUse hook asked for confirmation." : "Blocked by a preToolUse hook."),',
  "  };",
  "}",
  "",
  "async function allowsToolCall(",
  "  decision: ToolHookDecision,",
  "  ctx: ExtensionContext | undefined,",
  "): Promise<boolean> {",
  '  if (decision.kind !== "ask" || !ctx?.hasUI) return false;',
  "  try {",
  '    return await ctx.ui.confirm("Allow this tool call?", decision.reason);',
  "  } catch {",
  "    return false;",
  "  }",
  "}",
];

/**
 * Runs a hook command through the platform shell with `input` as its stdin
 * (empty when the event has no payload, so a command that reads stdin never
 * waits on Pi's own), bounded by the hook's `timeout` in seconds (Claude
 * Code's default of 600 when unset, as in the OpenCode-style plugin). A stdin
 * the command never reads is not an error.
 *
 * The command runs in its own process group (except on Windows), so a command
 * past its timeout is killed together with everything it started, and the
 * call rejects with a `HookTimeoutError` right away rather than waiting for a
 * descendant still holding its output open. Like `promisify(exec)`, which
 * earlier versions used, a non-zero exit rejects with an error carrying
 * `code`, `stdout` and `stderr`, and more than 1 MiB on either stream rejects
 * and kills the command.
 */
const RUN_HELPER_LINES = [
  "const MAX_HOOK_OUTPUT_LENGTH = 1024 * 1024;",
  "",
  "class HookTimeoutError extends Error {}",
  "",
  "function run(",
  "  command: string,",
  '  { input = "", seconds }: { input?: string; seconds: number },',
  "): Promise<{ stdout: string; stderr: string }> {",
  "  return new Promise((resolve, reject) => {",
  '    const detached = process.platform !== "win32";',
  "    const child = spawn(command, { shell: true, detached, windowsHide: true });",
  '    const output = { stdout: "", stderr: "" };',
  "    let settled = false;",
  "    const finish = (error?: Error) => {",
  "      if (settled) return;",
  "      settled = true;",
  "      clearTimeout(timer);",
  "      if (error) reject(error);",
  "      else resolve(output);",
  "    };",
  "    const killTree = () => {",
  "      try {",
  '        if (detached && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");',
  '        else child.kill("SIGKILL");',
  "      } catch {",
  "        // Already gone.",
  "      }",
  "      child.stdout?.destroy();",
  "      child.stderr?.destroy();",
  "    };",
  "    const timer = setTimeout(() => {",
  "      killTree();",
  "      finish(new HookTimeoutError(`Hook command timed out after ${seconds} seconds.`));",
  "    }, seconds * 1000);",
  '    for (const stream of ["stdout", "stderr"] as const) {',
  '      child[stream]?.setEncoding("utf8");',
  '      child[stream]?.on("data", (chunk: string) => {',
  "        output[stream] += chunk;",
  "        if (output[stream].length <= MAX_HOOK_OUTPUT_LENGTH) return;",
  "        killTree();",
  "        finish(new Error(`Hook command wrote more than 1 MiB to ${stream}.`));",
  "      });",
  "    }",
  '    child.on("error", (error) => finish(error));',
  '    child.on("close", (code, signal) => {',
  "      if (code === 0) return finish();",
  "      finish(",
  "        Object.assign(new Error(`Command failed: ${command}`), {",
  "          code,",
  "          signal,",
  "          stdout: output.stdout,",
  "          stderr: output.stderr,",
  "        }),",
  "      );",
  "    });",
  '    child.stdin?.on("error", () => {});',
  "    child.stdin?.end(input);",
  "  });",
  "}",
];

/**
 * Helper emitted alongside blocking handlers. `run` rejects on a
 * non-zero exit with an error carrying `stdout` / `stderr` / `code`, so the
 * reason is derived from the rejection rather than from a resolved exit code.
 * A command that could not be run at all (spawn failure, `maxBuffer` overflow)
 * also rejects, and is deliberately treated as a block: a gate that cannot run
 * must not silently pass. The `settle` gate is the exception (see
 * `PI_SETTLE_BLOCKING_EVENT`): such a failure is rethrown for Pi to report
 * instead of continuing the agent.
 *
 * The chosen text goes through `sanitizeBlockReason`, shared with the
 * OpenCode-style plugin (see `hook-block-reason.ts`): control and format
 * characters are stripped and the result is capped at 2000 characters.
 */
const BLOCK_REASON_HELPER_LINES = [
  ...buildBlockReasonSanitizerLines({ typed: true }),
  "",
  "function toBlockReason(error: unknown): string {",
  "  const result = error as { stdout?: unknown; stderr?: unknown; code?: unknown } | null;",
  '  const stderr = String(result?.stderr ?? "").trim();',
  '  const stdout = String(result?.stdout ?? "").trim();',
  "  const raw =",
  "    stderr ||",
  "    stdout ||",
  "    (result?.code !== undefined",
  "      ? `Hook command failed with exit code ${result.code}.`",
  "      : error instanceof Error",
  "        ? error.message",
  "        : String(error));",
  '  return sanitizeBlockReason(raw) || "Hook command failed.";',
  "}",
];

/**
 * Helper emitted alongside prompt-gate handlers. The cancel result (Pi's
 * `{ action: "handled" }`, oh-my-pi's `{ handled: true }`) has no reason field, so the reason reaches the user through `ctx.ui.notify` —
 * which is a no-op in print (`-p`) and JSON modes, and can itself throw when
 * the RPC channel is gone. Both cases fall back to stderr so a cancelled
 * prompt is never silent, and neither can stop the caller from cancelling it.
 */
const PROMPT_GATE_HELPER_LINES = [
  "function reportPromptGateFailure(ctx: ExtensionContext, reason: string): void {",
  "  try {",
  "    if (ctx.hasUI) {",
  '      ctx.ui.notify(reason, "error");',
  "      return;",
  "    }",
  "  } catch {",
  "    // The UI channel is best-effort; fall through to stderr.",
  "  }",
  "  console.error(reason);",
  "}",
];

/** Helper emitted alongside every stop gate (Pi's settle gate and oh-my-pi's `session_stop`). */
const STOP_HOOK_BLOCK_HELPER_LINES = [
  "function isStopHookBlock(error: unknown): boolean {",
  "  return (error as { code?: unknown } | null)?.code === 2;",
  "}",
];

/**
 * Helper emitted alongside the stop hook's settle gate. `event.entries` holds
 * the drafts earlier extensions proposed at this boundary, so they are kept and
 * the reason is appended after them as a displayed `custom_message`, which Pi
 * projects to a user message the model answers in the extra request.
 * `event.context.canContinue` is deliberately not consulted: at settlement the
 * last message is normally the assistant's, so it reads `false` until the
 * appended message is committed, and Pi re-validates the final context itself.
 */
const STOP_HOOK_HELPER_LINES = [
  "function continueAfterStopHook(",
  "  event: AgentBeforeSettleEvent,",
  "  reason: string,",
  "): AgentBeforeSettleEventResult {",
  "  return {",
  "    entries: [",
  "      ...event.entries,",
  "      {",
  '        type: "custom_message",',
  '        customType: "rulesync-stop-hook",',
  "        content: `Stop hook feedback:\\n${reason}`,",
  "        display: true,",
  "      },",
  "    ],",
  "    continue: true,",
  "  };",
  "}",
];

/**
 * Validate a hook matcher as a regular expression and return it as a JS
 * string-literal (JSON.stringify quoting) safe to embed in generated code.
 */
function matcherToEmbeddedLiteral(matcher: string): string {
  return JSON.stringify(sanitizeMatcherRegex(matcher));
}

type Handler = {
  command: string;
  matcher?: string;
  onlyOnError: boolean;
  /** Seconds before the command is killed. */
  timeout: number;
  /** Only `false` lets a timed-out `preToolUse` command allow the call. */
  failClosed: boolean | undefined;
  /** The `hook_event_name` of the stdin payload, when the event has one. */
  payload?: string;
};
type HandlerGroup = Record<string, Handler[]>;

function collectPiHandlers({
  effectiveHooks,
  eventMap,
}: {
  effectiveHooks: HooksConfig["hooks"];
  eventMap: Record<string, string>;
}): HandlerGroup {
  const handlerGroups: HandlerGroup = {};
  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    const piEvent = eventMap[canonicalEvent];
    if (!piEvent) continue;

    const handlers: Handler[] = [];
    for (const def of definitions) {
      if ((def.type ?? "command") !== "command") continue;
      if (!def.command) continue;
      handlers.push({
        command: def.command,
        matcher: def.matcher ? def.matcher : undefined,
        onlyOnError: PI_ERROR_GATED_CANONICAL_EVENTS.has(canonicalEvent),
        ...hookTimingOf(def),
        ...(PI_TOOL_EVENTS.has(piEvent) && STDIN_PAYLOAD_EVENTS[canonicalEvent]
          ? { payload: STDIN_PAYLOAD_EVENTS[canonicalEvent] }
          : {}),
      });
    }

    if (handlers.length > 0) {
      const existing = handlerGroups[piEvent];
      if (existing) {
        existing.push(...handlers);
      } else {
        handlerGroups[piEvent] = handlers;
      }
    }
  }
  return handlerGroups;
}

function buildCommandLines({
  handler,
  usesToolName,
  blocking,
  dialect,
}: {
  handler: Handler;
  usesToolName: boolean;
  blocking: BlockingMode;
  dialect: PiExtensionDialect;
}): string[] {
  const lines: string[] = [];
  const conditions: string[] = [];
  if (handler.onlyOnError) {
    conditions.push("event.isError");
  }
  if (usesToolName && handler.matcher) {
    conditions.push(
      `matchesTool(new RegExp(${matcherToEmbeddedLiteral(handler.matcher)}), event.toolName)`,
    );
  }
  const gated = conditions.length > 0;
  const indent = gated ? "      " : "    ";
  const options = [
    ...(handler.payload ? [`input: ${payloadAccessorName(handler.payload)}()`] : []),
    `seconds: ${handler.timeout}`,
  ];
  const runCall = `run(${JSON.stringify(handler.command)}, { ${options.join(", ")} })`;
  if (gated) {
    lines.push(`    if (${conditions.join(" && ")}) {`);
  }

  const onFailure = failureLinesByMode(dialect)[blocking];
  if (blocking === "tool") {
    lines.push(`${indent}try {`);
    lines.push(`${indent}  const decision = toolHookDecision((await ${runCall}).stdout);`);
    lines.push(
      `${indent}  if (decision && !(await allowsToolCall(decision, ctx))) return { block: true, reason: decision.reason };`,
    );
    lines.push(`${indent}} catch (error) {`);
    if (handler.failClosed === false) {
      // The OpenCode-style plugin's `failClosed: false` contract: only a
      // timeout is let through, and it is logged.
      lines.push(`${indent}  if (error instanceof HookTimeoutError) {`);
      lines.push(`${indent}    console.error("[rulesync-hooks] preToolUse hook timed out");`);
      lines.push(`${indent}  } else {`);
      for (const line of onFailure) {
        lines.push(`${indent}    ${line}`);
      }
      lines.push(`${indent}  }`);
    } else {
      for (const line of onFailure) {
        lines.push(`${indent}  ${line}`);
      }
    }
    lines.push(`${indent}}`);
  } else if (onFailure.length > 0) {
    lines.push(`${indent}try {`);
    lines.push(`${indent}  await ${runCall};`);
    lines.push(`${indent}} catch (error) {`);
    for (const line of onFailure) {
      lines.push(`${indent}  ${line}`);
    }
    lines.push(`${indent}}`);
  } else {
    lines.push(`${indent}await ${runCall};`);
  }

  if (gated) {
    lines.push("    }");
  }
  return lines;
}

/** The per-invocation closure a handler calls for its serialized payload. */
function payloadAccessorName(hookEventName: string): string {
  return `${hookEventName.charAt(0).toLowerCase()}${hookEventName.slice(1)}Input`;
}

/** Lazily serialized payloads the handlers of one subscription use. */
function buildPayloadLines(handlers: Handler[]): string[] {
  const payloads = [...new Set(handlers.flatMap((h) => (h.payload ? [h.payload] : [])))];
  const lines: string[] = [];
  for (const payload of payloads) {
    const accessor = payloadAccessorName(payload);
    const extra = STDIN_PAYLOAD_EXTRA_FIELDS[payload] ?? "";
    const extraArgument = extra ? `, { ${extra} }` : "";
    lines.push(`    let ${accessor}Cache: string | undefined;`);
    lines.push(
      `    const ${accessor} = () => (${accessor}Cache ??= toolHookInput(${JSON.stringify(payload)}, event, ctx${extraArgument}));`,
    );
  }
  return lines;
}

/**
 * The handler's parameter list. `ctx` is the second handler argument, so the
 * prompt gate and the payload builders (which read the session id and cwd)
 * name both.
 */
function handlerParams({
  handlers,
  readsEvent,
  isPromptGate,
}: {
  handlers: Handler[];
  readsEvent: boolean;
  isPromptGate: boolean;
}): string {
  const usesPayload = handlers.some((h) => h.payload);
  if (isPromptGate || usesPayload) return "event, ctx";
  return readsEvent || handlers.some((h) => h.onlyOnError) ? "event" : "";
}

function buildSubscriptionLines(
  handlerGroups: HandlerGroup,
  dialect: PiExtensionDialect,
): string[] {
  const lines: string[] = [];
  for (const [piEvent, handlers] of Object.entries(handlerGroups)) {
    const blocking = PI_BLOCKING_MODE_BY_EVENT[piEvent] ?? "none";
    const isPromptGate = blocking === "prompt";
    const isSettleGate = blocking === "settle";
    const isSessionStopGate = blocking === "sessionStop";
    const collectsStopFailures = isSettleGate || isSessionStopGate;
    const usesToolName = PI_TOOL_EVENTS.has(piEvent) && handlers.some((h) => h.matcher);
    const gatesOnAssistant = PI_ASSISTANT_MESSAGE_EVENTS.has(piEvent);
    const params = handlerParams({
      handlers,
      readsEvent: usesToolName || gatesOnAssistant || collectsStopFailures,
      isPromptGate,
    });
    lines.push(`  pi.on(${JSON.stringify(piEvent)}, async (${params}) => {`);
    if (gatesOnAssistant) {
      lines.push(`    if (event.message.role !== "assistant") return;`);
    }
    if (isPromptGate) {
      // The canonical event covers prompts the user submits; Pi also fires
      // `input` for messages another extension injects via `sendUserMessage`,
      // which a user's prompt gate should not cancel.
      lines.push(`    if (event.source === "extension") ${dialect.promptPassLine}`);
    }
    if (collectsStopFailures) {
      lines.push("    const stopHookFailures: unknown[] = [];");
    }
    lines.push(...buildPayloadLines(handlers));
    for (const handler of handlers) {
      lines.push(
        ...buildCommandLines({
          handler,
          usesToolName,
          blocking,
          dialect,
        }),
      );
    }
    if (isPromptGate) {
      lines.push(`    ${dialect.promptPassLine}`);
    }
    if (isSettleGate) {
      // Only a completed run is continued: an aborted one is the user stopping
      // the agent, and an errored one is a provider failure Claude Code's
      // `Stop` does not fire for either. A failure that does not continue the
      // agent is rethrown so Pi reports it, as it did for the notify-only
      // `agent_end` mapping; returning nothing keeps another extension's
      // `continue` decision.
      lines.push("    const blocks = stopHookFailures.filter(isStopHookBlock);");
      lines.push(
        '    if (blocks.length > 0 && !stopHookContinued && event.outcome === "completed") {',
      );
      lines.push("      stopHookContinued = true;");
      lines.push(
        '      return continueAfterStopHook(event, blocks.map(toBlockReason).join("\\n\\n"));',
      );
      lines.push("    }");
      lines.push("    if (stopHookFailures.length > 0) throw stopHookFailures[0];");
    }
    if (isSessionStopGate) {
      // See `OMP_SESSION_STOP_BLOCKING_EVENT` for the continue-once and
      // provider-error gates. Returning nothing lets the run settle and keeps
      // another extension's continuation request.
      lines.push("    const blocks = stopHookFailures.filter(isStopHookBlock);");
      lines.push(
        '    const endedOnError = (event.last_assistant_message as { stopReason?: unknown } | undefined)?.stopReason === "error";',
      );
      lines.push("    if (blocks.length > 0 && !event.stop_hook_active && !endedOnError) {");
      lines.push("      return {");
      lines.push("        continue: true,");
      lines.push(
        '        additionalContext: `Stop hook feedback:\\n${blocks.map(toBlockReason).join("\\n\\n")}`,',
      );
      lines.push("      };");
      lines.push("    }");
      lines.push("    if (stopHookFailures.length > 0) throw stopHookFailures[0];");
    }
    lines.push("  });");
    if (isSettleGate) {
      lines.push(`  pi.on("agent_settled", async () => {`);
      lines.push("    stopHookContinued = false;");
      lines.push("  });");
    }
  }
  return lines;
}

/** Whether a handler belongs to a tool event, where its matcher is tested. */
function handlerGroupHasToolEvent(handlerGroups: HandlerGroup, handler: Handler): boolean {
  return Object.entries(handlerGroups).some(
    ([piEvent, handlers]) => PI_TOOL_EVENTS.has(piEvent) && handlers.includes(handler),
  );
}

/**
 * Generate the rulesync-owned Pi extension (a TypeScript module with a
 * default-export factory receiving Pi's ExtensionAPI) that subscribes to the
 * mapped lifecycle events and executes the configured hook commands via the
 * platform shell. Handlers observe events, except on `tool_call` — Pi's tool
 * gate — where a hook command that exits non-zero denies the call with
 * `{ block: true, reason }`, and on `input` — Pi's prompt-submission gate —
 * where a non-zero exit cancels the prompt with the dialect's cancel result
 * (`{ action: "handled" }` for Pi, `{ handled: true }` for oh-my-pi), and
 * on `agent_before_settle` (Pi) / `session_stop` (oh-my-pi), where a stop
 * command exiting with code 2 asks the agent to continue once with the
 * command's output as feedback.
 * `postToolUse` and `postToolUseFailure` share Pi's `tool_result` event; the
 * latter's commands run only when `event.isError` is set.
 * Commands on the tool events receive Claude Code's hook input on stdin (see
 * `STDIN_PAYLOAD_EVENTS`), and a tool matcher is tested against both Pi's tool
 * name and its canonical Claude Code name. On `tool_call`, a command that exits
 * 0 with a JSON deny decision also denies the call, and one past its `timeout`
 * denies it unless the hook sets `failClosed: false`, mirroring the
 * OpenCode-style plugin.
 *
 * @see https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
 */
export function generatePiExtensionCode({
  config,
  supportedEvents,
  eventMap,
  dialect = PI_EXTENSION_DIALECT,
}: {
  config: HooksConfig;
  supportedEvents: readonly string[];
  eventMap: Record<string, string>;
  dialect?: PiExtensionDialect;
}): string {
  const supported: Set<string> = new Set(supportedEvents);
  const configHooks = { ...config.hooks, ...config[dialect.overrideKey]?.hooks };
  const effectiveHooks: HooksConfig["hooks"] = {};

  for (const [event, defs] of Object.entries(configHooks)) {
    if (supported.has(event)) effectiveHooks[event] = defs;
  }

  const handlerGroups = collectPiHandlers({ effectiveHooks, eventMap });
  const subscriptionLines = buildSubscriptionLines(handlerGroups, dialect);
  const hasPromptGate = Boolean(handlerGroups[PI_PROMPT_BLOCKING_EVENT]);
  const hasSettleGate = Boolean(handlerGroups[PI_SETTLE_BLOCKING_EVENT]);
  const hasSessionStopGate = Boolean(handlerGroups[OMP_SESSION_STOP_BLOCKING_EVENT]);
  const allHandlers = Object.values(handlerGroups).flat();
  const needsToolHelpers = allHandlers.some(
    (h) => h.payload || (h.matcher && handlerGroupHasToolEvent(handlerGroups, h)),
  );
  const hasToolGate = Boolean(handlerGroups[PI_BLOCKING_EVENT]);
  const needsBlockReasonHelper =
    hasToolGate || hasPromptGate || hasSettleGate || hasSessionStopGate;

  const lines: string[] = ["// Generated by rulesync. Do not edit manually."];
  if (subscriptionLines.length === 0) {
    lines.push("export default function () {}");
    lines.push("");
    return lines.join("\n");
  }

  const importedTypes = [
    ...(hasSettleGate ? ["AgentBeforeSettleEvent", "AgentBeforeSettleEventResult"] : []),
    "ExtensionAPI",
    ...(hasPromptGate || needsToolHelpers ? ["ExtensionContext"] : []),
  ].join(", ");
  lines.push('import { spawn } from "node:child_process";');
  if (needsToolHelpers) {
    lines.push('import { homedir } from "node:os";');
    lines.push('import { resolve as resolvePath } from "node:path";');
  }
  lines.push("");
  lines.push(`import type { ${importedTypes} } from ${JSON.stringify(dialect.typesPackage)};`);
  lines.push("");
  const helperBlocks: ReadonlyArray<readonly [boolean, readonly string[]]> = [
    [true, RUN_HELPER_LINES],
    [needsBlockReasonHelper, BLOCK_REASON_HELPER_LINES],
    [hasToolGate, TOOL_DECISION_HELPER_LINES],
    [needsToolHelpers, needsToolHelpers ? buildToolPayloadHelperLines(dialect) : []],
    [hasPromptGate, PROMPT_GATE_HELPER_LINES],
    [hasSettleGate || hasSessionStopGate, STOP_HOOK_BLOCK_HELPER_LINES],
    [hasSettleGate, STOP_HOOK_HELPER_LINES],
  ];
  for (const [included, block] of helperBlocks) {
    if (included) lines.push(...block, "");
  }
  lines.push("export default function (pi: ExtensionAPI) {");
  if (hasSettleGate) {
    // Per extension instance, so each session gets its own continue-once guard.
    lines.push("  let stopHookContinued = false;");
  }
  lines.push(...subscriptionLines);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
