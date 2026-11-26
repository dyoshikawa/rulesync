import { HooksConfig } from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import { buildBlockReasonSanitizerLines } from "./hook-block-reason.js";
import {
  buildPayloadClosureLines,
  buildRunHelperLines,
  buildRunStatement,
  commandAndInputOf,
  createOpencodeMatcherTranslator,
  hookTimingOf,
  type OpencodeMatcherTranslator,
  type RunnableHandler,
  type StdinPayload,
  validateAndSanitizeMatcher,
  sessionContextExtrasFor,
  usesSessionContext,
  wrapSessionStartLines,
} from "./opencode-style-generator.js";

/**
 * Generator for the OpenCode V2 (OpenCode 2.x) hooks plugin.
 *
 * OpenCode 2.x no longer runs V1 plugin modules: a plugin must default-export
 * `{ id, setup(ctx) }`. Inside `setup` hooks are registered per domain
 * (`await ctx.tool.hook("execute.before", handler)`), and lifecycle events
 * are read from `ctx.event.subscribe({ types, signal })`, an async iterable of
 * the public event stream whose payload lives under `event.data`. `types`
 * narrows the stream to the event types the plugin handles (a newer 2.x
 * option; the per-type checks inside the loop stay, so an older 2.x that
 * ignores it still runs each command only for its own event).
 *
 * Commands run in the plugin location's directory (see `buildRunHelperLines`).
 *
 * @see https://opencode.ai/v2/docs/build/plugins/
 */

/** Tool name OpenCode V2 gives its shell tool (V1 called it `bash`). */
const OPENCODE_V2_SHELL_TOOL = "shell";

/**
 * Canonical (Claude Code) tool names mapped to the lowercase names OpenCode 2.x
 * reports in `event.tool`, which a matcher is tested against case-sensitively.
 * Observed on OpenCode 2.3.2: a `preToolUse` hook fires with `read`, `write`,
 * `edit` and `shell`, so a canonical `Read|Edit|Write` or `Bash` never matched.
 * `Bash` becomes the V2 name `shell`; the generated helper still accepts the
 * V1 name `bash` for a matcher written that way.
 * https://opencode.ai/v2/docs/build/plugins/
 */
const CANONICAL_TO_OPENCODE_V2_TOOL_NAMES: Readonly<Record<string, string>> = {
  Bash: OPENCODE_V2_SHELL_TOOL,
  Read: "read",
  Write: "write",
  Edit: "edit",
};

/**
 * Per-canonical-event conditions the generated handler gates on, because the
 * hook point or event it shares fires more broadly than the canonical event:
 * - the shell events run only for the `shell` tool's calls;
 * - `execute.after` reports both outcomes in `status`, split into
 *   `postToolUse` (`completed`) and `postToolUseFailure` (`error`);
 * - `permission.replied` fires for every reply, so `permissionDenied` runs only
 *   for a rejecting one.
 */
const OPENCODE_V2_HANDLER_GATES: Record<string, string> = {
  beforeShellExecution: `event.tool === "${OPENCODE_V2_SHELL_TOOL}"`,
  afterShellExecution: `event.tool === "${OPENCODE_V2_SHELL_TOOL}"`,
  postToolUse: 'event.status === "completed"',
  postToolUseFailure: 'event.status === "error"',
  permissionDenied: 'event.data?.reply === "reject"',
};

/**
 * The V2 counterparts of the V1 stdin payloads (`STDIN_PAYLOADS`), plus
 * Claude Code's `PostToolUseFailure` input for a failed call.
 */
const TOOL_CALL_FIELDS = [
  "session_id: event.sessionID",
  "tool_use_id: event.id",
  "tool_name: event.tool",
  "tool_input: event.input",
];
const OPENCODE_V2_STDIN_PAYLOADS: Record<string, StdinPayload> = {
  preToolUse: { name: "PreToolUse", fields: TOOL_CALL_FIELDS },
  postToolUse: {
    name: "PostToolUse",
    fields: [...TOOL_CALL_FIELDS, "tool_response: event.result"],
  },
  postToolUseFailure: {
    name: "PostToolUseFailure",
    fields: [...TOOL_CALL_FIELDS, "error: event.error?.message ?? event.error"],
  },
  stop: {
    name: "Stop",
    fields: ["session_id: sessionID", "stop_hook_active: stopHookActive"],
  },
};

/**
 * Helper the generated plugin defines when a handler has a matcher. A matcher
 * is tested against the V2 tool name and, for a tool OpenCode 2.x renamed,
 * against its OpenCode 1.x name too (`shell` was `bash`, `subagent` was
 * `task`), so a matcher written for the V1 tool names keeps firing instead of
 * silently failing open.
 */
const TOOL_MATCHER_HELPER = "__rulesyncMatchesTool";

const TOOL_MATCHER_HELPER_LINES: readonly string[] = [
  'const __rulesyncV1ToolNames = { shell: "bash", subagent: "task" };',
  `const ${TOOL_MATCHER_HELPER} = (pattern, tool) =>`,
  "  pattern.test(tool) ||",
  "  (Object.hasOwn(__rulesyncV1ToolNames, tool) && pattern.test(__rulesyncV1ToolNames[tool]));",
];

/** Hook points whose `matcher` is tested against the tool name. */
const OPENCODE_V2_MATCHABLE_HOOKS: ReadonlySet<string> = new Set([
  "tool:execute.before",
  "tool:execute.after",
]);

/** The session a V2 `session.created` / `session.deleted` event is about. */
const V2_SESSION_ID_EXPRESSION = "event.data?.sessionID";

/**
 * The `session:context` registration that adds a session's `sessionStart`
 * context to the system prompt of each of its agent-loop model requests. A
 * host that cannot register it (no `ctx.session.hook`, or no `context` hook
 * point) gets a logged error instead of a setup throw, so the plugin's other
 * hooks, `preToolUse` guards included, still load.
 */
const SESSION_CONTEXT_HOOK_LINES: readonly string[] = [
  "try {",
  "  __rulesyncRegistrations.push(",
  '    await ctx.session.hook("context", async (event) => {',
  "      const context = await __rulesyncSessionContext(event?.sessionID);",
  '      if (context && Array.isArray(event?.system)) event.system.push({ type: "text", text: context });',
  "    }),",
  "  );",
  "} catch (error) {",
  '  console.error("[rulesync-hooks] could not register the session context hook; sessionStart output does not reach the model:", error);',
  "}",
];

type V2Handler = RunnableHandler & {
  matcher?: string;
  gate?: string;
};

/** Wrap a statement in the handler's gate and matcher conditions. */
function wrapInConditions(handler: V2Handler, statement: string, indent: string): string[] {
  const conditions: string[] = [];
  if (handler.gate) conditions.push(handler.gate);
  if (handler.matcher) {
    conditions.push(
      `${TOOL_MATCHER_HELPER}(new RegExp("${validateAndSanitizeMatcher(handler.matcher)}"), event.tool)`,
    );
  }
  if (conditions.length === 0) return [`${indent}${statement}`];
  return [`${indent}if (${conditions.join(" && ")}) {`, `${indent}  ${statement}`, `${indent}}`];
}

/** Emit one `ctx.<domain>.hook(name, ...)` registration. */
function buildHookRegistrationLines(hookPoint: string, handlers: V2Handler[]): string[] {
  const separator = hookPoint.indexOf(":");
  const domain = hookPoint.slice(0, separator);
  const name = hookPoint.slice(separator + 1);
  const lines: string[] = [];
  lines.push("__rulesyncRegistrations.push(");
  lines.push(`  await ctx.${domain}.hook("${name}", async (event) => {`);
  lines.push(
    ...buildPayloadClosureLines({ handlers, cwdExpression: "directory" }).map(
      (line) => `    ${line}`,
    ),
  );
  for (const handler of handlers) {
    lines.push(...wrapInConditions(handler, buildRunStatement(handler), "    "));
  }
  lines.push("  }),");
  lines.push(");");
  return lines;
}

/**
 * Emit the event-stream loop. Event handlers are non-blocking, so
 * `__rulesyncRunHook` logs a failing command instead of throwing, and it
 * neither skips its siblings nor ends the subscription. Each handler also runs
 * in its own try/catch, so a throw while evaluating its gate or building its
 * payload, outside `__rulesyncRunHook`, is logged the same way. The
 * subscription passes `types` so the server delivers only the handled events.
 *
 * The loop itself never waits for a command, so a slow handler cannot hold back
 * the events after it: handlers run one after another on
 * `__rulesyncEventQueue`, in event order, while `sessionStart` starts right
 * away, outside the queue (so it can overlap other event commands), and its
 * session's pending context is registered before that session's first model
 * request asks for it. Handlers still queued at dispose are skipped.
 */
function buildEventLoopLines({
  eventHandlers,
  usesContext,
  usesStop,
}: {
  eventHandlers: Map<string, V2Handler[]>;
  usesContext: boolean;
  usesStop: boolean;
}): string[] {
  const lines: string[] = [];
  // Event types come from the internal event map, never from user input. A
  // deleted session's `sessionStart` context is dropped, so its event is read too.
  const eventTypes = new Set(eventHandlers.keys());
  if (usesContext) eventTypes.add("session.deleted");
  if (usesStop) {
    for (const eventType of STOP_GUARD_RESET_EVENTS) eventTypes.add(eventType);
  }
  const types = [...eventTypes].map((eventType) => JSON.stringify(eventType)).join(", ");
  lines.push("const __rulesyncEvents = new AbortController();");
  lines.push("let __rulesyncEventQueue = Promise.resolve();");
  lines.push("void (async () => {");
  lines.push("  for await (const event of ctx.event.subscribe({");
  lines.push(`    types: [${types}],`);
  lines.push("    signal: __rulesyncEvents.signal,");
  lines.push("  })) {");
  if (usesContext) {
    lines.push(
      `    if (event.type === "session.deleted") __rulesyncSessionContexts.delete(${V2_SESSION_ID_EXPRESSION});`,
    );
  }
  if (usesStop) {
    const condition = STOP_GUARD_RESET_EVENTS.map((type) => `event.type === "${type}"`).join(
      " || ",
    );
    lines.push(
      `    if (${condition}) __rulesyncStopHookContinued.delete(${V2_SESSION_ID_EXPRESSION});`,
    );
  }
  let isFirst = true;
  for (const [eventType, handlers] of eventHandlers) {
    lines.push(`    ${isFirst ? "if" : "} else if"} (event.type === "${eventType}") {`);
    isFirst = false;
    const statements = buildPayloadClosureLines({ handlers, cwdExpression: "directory" });
    for (const handler of handlers) {
      statements.push("try {");
      statements.push(...wrapInConditions(handler, buildRunStatement(handler), "  "));
      statements.push("} catch (error) {");
      const message = JSON.stringify(`[rulesync-hooks] ${handler.event} hook failed:`);
      statements.push(`  console.error(${message}, error);`);
      statements.push("}");
    }
    const body = usesSessionContext(handlers)
      ? wrapSessionStartLines(V2_SESSION_ID_EXPRESSION, statements, "void")
      : [
          "__rulesyncEventQueue = __rulesyncEventQueue",
          "  .then(async () => {",
          // A handler still queued when the plugin is disposed does not start.
          "    if (__rulesyncEvents.signal.aborted) return;",
          ...statements.map((line) => `    ${line}`),
          "  })",
          `  .catch((error) => console.error(${JSON.stringify(`[rulesync-hooks] ${eventType} event hook failed:`)}, error));`,
        ];
    lines.push(...body.map((line) => `      ${line}`));
  }
  lines.push("    }");
  lines.push("  }");
  lines.push("})().catch(() => {});");
  return lines;
}

/**
 * The session hook `stop` maps to (OpenCode 2.2.1+). It is marked experimental
 * upstream ("its name and shape may still change"), and OpenCode's own `/goal`
 * plugin is built on it.
 *
 * @see https://github.com/anomalyco/opencode/blob/v2.4.2/packages/plugin/src/README.md
 */
const OPENCODE_V2_IDLE_HOOK_POINT = "session:experimental.idle";

/**
 * The event `stop` falls back to on OpenCode 2.x before 2.2.1, where the host
 * stores a hook registration under an unknown name without complaint and never
 * triggers it. OpenCode publishes it when an execution ends, after the drain
 * loop that runs `experimental.idle` (`session/execution.ts`), so once the idle
 * hook has run the host is known to support it and the fallback stands down.
 */
const OPENCODE_V2_STOP_FALLBACK_EVENT = "session.execution.succeeded";

/**
 * Events after which a continued session will not reach `experimental.idle`
 * again in that execution (it failed or was interrupted), so its continue-once
 * guard is cleared; otherwise the next turn's first stop would be told
 * `stop_hook_active` and could not continue.
 */
const STOP_GUARD_RESET_EVENTS: readonly string[] = [
  "session.execution.failed",
  "session.execution.interrupted",
];

/**
 * Helpers the generated plugin defines when a `stop` handler is present: the
 * state the idle hook and the fallback share, and a check for a subagent
 * session (one with a `parentID`). Claude Code's `Stop` does not fire for
 * subagents (that is `SubagentStop`), but OpenCode runs `experimental.idle`
 * for child sessions too, so stop commands skip them. A host whose
 * `ctx.session.get` fails is treated as a main session.
 */
const STOP_STATE_LINES: readonly string[] = [
  "const __rulesyncStopHookContinued = new Set();",
  "let __rulesyncIdleSupported = false;",
  "const __rulesyncIsSubagentSession = async (sessionID) => {",
  "  try {",
  "    return Boolean((await ctx.session.get({ sessionID }))?.parentID);",
  "  } catch {",
  "    return false;",
  "  }",
  "};",
];

/** The stdin payload of a fallback (observe-only) stop command. */
const STOP_FALLBACK_PAYLOAD: StdinPayload = {
  name: "Stop",
  fields: [`session_id: ${V2_SESSION_ID_EXPRESSION}`, "stop_hook_active: false"],
};

/**
 * Helper the generated plugin defines when a `stop` handler is present. It runs
 * one stop command and returns the reason to continue the agent with when the
 * command exits with code 2 (its stderr, else its stdout, sanitized), like a
 * blocking Claude Code `Stop` hook. Any other failure is only logged: the safe
 * side of a stop hook is to let the agent stop rather than to pay for an extra
 * model request. The command's output is read rather than echoed, so the
 * output of a failing command is logged with the failure.
 */
const STOP_HOOK_HELPER_LINES: readonly string[] = [
  "const __rulesyncRunStopHook = async ({ command, input, seconds }) => {",
  "  const result = await __rulesyncRunCommand({ command, input, seconds });",
  "  if (result === null) {",
  '    console.error("[rulesync-hooks] stop hook timed out after " + seconds + "s");',
  "    return undefined;",
  "  }",
  "  if (result.exitCode === 0) return undefined;",
  '  const output = String(result.stderr ?? "").trim() || String(result.stdout ?? "").trim();',
  '  if (result.exitCode === 2) return sanitizeBlockReason(output) || "Stop hook exited with code 2.";',
  '  console.error("[rulesync-hooks] stop hook exited with code " + result.exitCode + (output ? ": " + sanitizeBlockReason(output) : ""));',
  "  return undefined;",
  "};",
];

/**
 * Emit the `experimental.idle` registration that runs the `stop` commands.
 *
 * - The Session's own subagents and other background jobs wake it when they
 *   finish, and the hook runs again then, so the commands wait for that run;
 *   shells are not waited for, since a background shell (a dev server) may run
 *   for good. This follows OpenCode's own `/goal` plugin.
 * - Every stop command runs. When any exits with code 2, their combined reasons
 *   are admitted with `ctx.session.synthetic()`, which continues the same
 *   execution. The hook runs again after that input, so a session that was just
 *   continued is not continued again: its commands run with `stop_hook_active`
 *   set and the session goes idle. The next idle after that may continue again.
 * - Subagent sessions are skipped (see `STOP_STATE_LINES`).
 * - A hook that throws fails the execution, so every failure is logged instead.
 * - Before 2.2.1 the hook never runs, and the observe-only fallback on
 *   `session.execution.succeeded` runs the commands instead (see
 *   `OPENCODE_V2_STOP_FALLBACK_EVENT`). A host that throws on the registration
 *   is logged, and the plugin's other hooks still load.
 */
function buildIdleHookLines(handlers: V2Handler[]): string[] {
  const separator = OPENCODE_V2_IDLE_HOOK_POINT.indexOf(":");
  const name = OPENCODE_V2_IDLE_HOOK_POINT.slice(separator + 1);
  const lines: string[] = [];
  lines.push("try {");
  lines.push("  __rulesyncRegistrations.push(");
  lines.push(`    await ctx.session.hook("${name}", async (event) => {`);
  lines.push("      try {");
  lines.push("        __rulesyncIdleSupported = true;");
  lines.push("        const sessionID = event?.sessionID;");
  lines.push(
    "        const background = Array.isArray(event?.background) ? event.background : [];",
  );
  lines.push(
    '        if (background.some((work) => work?.kind !== "shell" && work?.sessionID === sessionID)) return;',
  );
  lines.push("        if (await __rulesyncIsSubagentSession(sessionID)) return;");
  lines.push("        const stopHookActive = __rulesyncStopHookContinued.delete(sessionID);");
  lines.push(
    ...buildPayloadClosureLines({ handlers, cwdExpression: "directory" }).map(
      (line) => `        ${line}`,
    ),
  );
  lines.push("        const reasons = [];");
  for (const handler of handlers) {
    const { command, input } = commandAndInputOf(handler);
    lines.push("        try {");
    lines.push(
      `          const reason = await __rulesyncRunStopHook({ command: ${command}, input: ${input}, seconds: ${handler.timeout} });`,
    );
    lines.push("          if (reason) reasons.push(reason);");
    lines.push("        } catch (error) {");
    lines.push('          console.error("[rulesync-hooks] stop hook failed:", error);');
    lines.push("        }");
  }
  lines.push("        if (reasons.length === 0 || stopHookActive) return;");
  lines.push("        await ctx.session.synthetic({");
  lines.push("          sessionID,");
  lines.push('          text: "Stop hook feedback:\\n" + reasons.join("\\n\\n"),');
  lines.push("        });");
  lines.push("        __rulesyncStopHookContinued.add(sessionID);");
  lines.push("      } catch (error) {");
  lines.push('        console.error("[rulesync-hooks] stop hook failed:", error);');
  lines.push("      }");
  lines.push("    }),");
  lines.push("  );");
  lines.push("} catch (error) {");
  lines.push(
    '  console.error("[rulesync-hooks] could not register the experimental.idle hook; stop hooks only observe:", error);',
  );
  lines.push("}");
  return lines;
}

/**
 * Every hook point but `execute.after` and `experimental.idle` runs before its
 * action, which a throw aborts; the event stream only observes, and a stop
 * command can only ask the agent to continue (see `buildIdleHookLines`).
 */
export function isBlockingOpencodeV2Target(target: string): boolean {
  return (
    !target.startsWith("event:") &&
    target !== "tool:execute.after" &&
    target !== OPENCODE_V2_IDLE_HOOK_POINT
  );
}

/** Build the handlers of one canonical event's command definitions. */
function buildHandlersFor({
  canonicalEvent,
  definitions,
  target,
  translateMatcher,
}: {
  canonicalEvent: string;
  definitions: HooksConfig["hooks"][string];
  target: string;
  translateMatcher: OpencodeMatcherTranslator;
}): V2Handler[] {
  const gate = OPENCODE_V2_HANDLER_GATES[canonicalEvent];
  const payload = OPENCODE_V2_STDIN_PAYLOADS[canonicalEvent];
  // The shell events and the non-tool hook points have nothing to test a
  // matcher against; matcher-carrying definitions there are skipped, matching
  // the "Skipped matcher hook(s)" warning the processor already emitted.
  const isShellEvent =
    canonicalEvent === "beforeShellExecution" || canonicalEvent === "afterShellExecution";
  const matcherSupported = !isShellEvent && OPENCODE_V2_MATCHABLE_HOOKS.has(target);

  const handlers: V2Handler[] = [];
  for (const def of definitions) {
    if ((def.type ?? "command") !== "command") continue;
    if (!def.command) continue;
    if (def.matcher && !matcherSupported) continue;
    handlers.push({
      command: def.command,
      event: canonicalEvent,
      blocking: isBlockingOpencodeV2Target(target),
      ...hookTimingOf(def),
      ...(def.matcher ? { matcher: translateMatcher(def.matcher, canonicalEvent) } : {}),
      ...(gate ? { gate } : {}),
      ...(payload ? { payload } : {}),
      ...sessionContextExtrasFor(canonicalEvent),
    });
  }
  return handlers;
}

/** Emit the statements of the `setup` function body. */
function buildSetupBodyLines({
  hookHandlers,
  eventHandlers,
  stopHandlers,
}: {
  hookHandlers: Map<string, V2Handler[]>;
  eventHandlers: Map<string, V2Handler[]>;
  stopHandlers: V2Handler[];
}): string[] {
  if (hookHandlers.size === 0 && eventHandlers.size === 0 && stopHandlers.length === 0) return [];

  const allHandlers = [...hookHandlers.values(), ...eventHandlers.values(), stopHandlers].flat();
  const body: string[] = [
    "const directory = ctx.location?.directory ?? process.cwd();",
    "",
    ...buildRunHelperLines({ handlers: allHandlers, cwdExpression: "directory" }),
  ];
  if (stopHandlers.length > 0) {
    // The preToolUse helpers already define `sanitizeBlockReason`.
    const definesSanitizer = allHandlers.some((handler) => handler.payload?.name === "PreToolUse");
    if (!definesSanitizer) body.push("", ...buildBlockReasonSanitizerLines({ typed: false }));
    body.push("", ...STOP_HOOK_HELPER_LINES);
  }
  const usesMatcher = [...hookHandlers.values()].some((handlers) =>
    handlers.some((handler) => handler.matcher !== undefined),
  );
  if (usesMatcher) {
    body.push("", ...TOOL_MATCHER_HELPER_LINES);
  }
  const usesContext = [...eventHandlers.values()].some(usesSessionContext);
  const registers = hookHandlers.size > 0 || usesContext || stopHandlers.length > 0;
  const cleanup: string[] = [];
  if (registers) {
    body.push("", "const __rulesyncRegistrations = [];");
    for (const [hookPoint, handlers] of hookHandlers) {
      body.push(...buildHookRegistrationLines(hookPoint, handlers));
    }
    if (usesContext) body.push(...SESSION_CONTEXT_HOOK_LINES);
    if (stopHandlers.length > 0)
      body.push(...STOP_STATE_LINES, ...buildIdleHookLines(stopHandlers));
  }
  const usesStop = stopHandlers.length > 0;
  if (usesStop) {
    // The fallback runs the same commands, observe-only, while the idle hook is
    // not known to be supported, and never for a subagent session.
    const gate = `!__rulesyncIdleSupported && !(await __rulesyncIsSubagentSession(${V2_SESSION_ID_EXPRESSION}))`;
    eventHandlers.set(OPENCODE_V2_STOP_FALLBACK_EVENT, [
      ...(eventHandlers.get(OPENCODE_V2_STOP_FALLBACK_EVENT) ?? []),
      ...stopHandlers.map((handler) => ({
        ...handler,
        blocking: false,
        gate,
        payload: STOP_FALLBACK_PAYLOAD,
      })),
    ]);
  }
  if (eventHandlers.size > 0) {
    body.push("", ...buildEventLoopLines({ eventHandlers, usesContext, usesStop }));
    cleanup.push("  __rulesyncEvents.abort();");
  }
  if (registers) {
    cleanup.push(
      "  await Promise.all(__rulesyncRegistrations.map((registration) => registration.dispose()));",
    );
  }
  body.push("", "return async () => {", ...cleanup, "};");
  return body;
}

export function generateOpencodeV2PluginCode({
  config,
  supportedEvents,
  toolConfigKey,
  eventMap,
  logger,
}: {
  config: HooksConfig;
  supportedEvents: readonly string[];
  toolConfigKey: "opencode" | "opencodev1" | "mimocode";
  eventMap: Record<string, string>;
  logger?: Logger;
}): string {
  const supported: Set<string> = new Set(supportedEvents);
  const configHooks = { ...config.hooks, ...config[toolConfigKey]?.hooks };
  const translateMatcher = createOpencodeMatcherTranslator({
    toolNames: CANONICAL_TO_OPENCODE_V2_TOOL_NAMES,
    toolConfigKey,
    logger,
  });

  // Keyed by `<domain>:<name>` hook point and by event type respectively, in
  // first-seen order.
  const hookHandlers = new Map<string, V2Handler[]>();
  const eventHandlers = new Map<string, V2Handler[]>();
  const stopHandlers: V2Handler[] = [];

  for (const [canonicalEvent, definitions] of Object.entries(configHooks)) {
    if (!supported.has(canonicalEvent)) continue;
    const target = eventMap[canonicalEvent];
    if (!target) continue;
    const handlers = buildHandlersFor({
      canonicalEvent,
      definitions,
      target,
      translateMatcher,
    });
    if (handlers.length === 0) continue;
    if (target === OPENCODE_V2_IDLE_HOOK_POINT) {
      stopHandlers.push(...handlers);
      continue;
    }
    const isEvent = target.startsWith("event:");
    const key = isEvent ? target.slice("event:".length) : target;
    const group = isEvent ? eventHandlers : hookHandlers;
    group.set(key, [...(group.get(key) ?? []), ...handlers]);
  }

  const body = buildSetupBodyLines({ hookHandlers, eventHandlers, stopHandlers });
  const lines: string[] = [];
  lines.push("export default {");
  // OpenCode 2.x loads one plugin per id, from the global config and from every
  // `.opencode` directory up from the project, so a fixed id would silently drop
  // all but one of them. The module URL makes the id unique per plugin file.
  lines.push('  id: "rulesync-hooks:" + import.meta.url,');
  lines.push(`  setup: async (${body.length > 0 ? "ctx" : ""}) => {`);
  for (const line of body) {
    lines.push(line === "" ? "" : `    ${line}`);
  }
  lines.push("  },");
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}
