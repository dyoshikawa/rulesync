import { HooksConfig } from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { capitalizedMatcherNames, replaceMatcherNames } from "./hook-matcher-tool-names.js";
import {
  buildPayloadClosureLines,
  buildRunHelperLines,
  buildRunStatement,
  hookTimingOf,
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
 * Rewrite the canonical tool names in a matcher to their OpenCode 2.x names,
 * warning about a capitalized name left over (`MultiEdit`, `NotebookEdit`),
 * which no lowercase OpenCode tool name can match.
 */
function canonicalToOpencodeV2Matcher({
  matcher,
  eventName,
  logger,
}: {
  matcher: string;
  eventName: string;
  logger?: Logger;
}): string {
  const translated = replaceMatcherNames(matcher, CANONICAL_TO_OPENCODE_V2_TOOL_NAMES);
  const unmatched = capitalizedMatcherNames(translated);
  if (unmatched.length > 0) {
    logger?.warn(
      `OpenCode matches hook matchers case-sensitively against lowercase tool names, and ` +
        `${unmatched.map((name) => quoteValueForWarning(name)).join(", ")} in the ` +
        `"${eventName}" matcher ${quoteValueForWarning(matcher)} has no known OpenCode ` +
        `equivalent, so it is written as-is and will likely never match. Use the tool name ` +
        `OpenCode reports instead.`,
    );
  }
  return translated;
}

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
  stop: { name: "Stop", fields: ["session_id: event.data?.sessionID"] },
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
function buildEventLoopLines(
  eventHandlers: Map<string, V2Handler[]>,
  usesContext: boolean,
): string[] {
  const lines: string[] = [];
  // Event types come from the internal event map, never from user input. A
  // deleted session's `sessionStart` context is dropped, so its event is read too.
  const eventTypes = new Set(eventHandlers.keys());
  if (usesContext) eventTypes.add("session.deleted");
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
 * Every hook point but `execute.after` runs before its action, which a throw
 * aborts; the event stream only observes.
 */
export function isBlockingOpencodeV2Target(target: string): boolean {
  return !target.startsWith("event:") && target !== "tool:execute.after";
}

/** Build the handlers of one canonical event's command definitions. */
function buildHandlersFor({
  canonicalEvent,
  definitions,
  target,
  logger,
}: {
  canonicalEvent: string;
  definitions: HooksConfig["hooks"][string];
  target: string;
  logger?: Logger;
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
      ...(def.matcher
        ? {
            matcher: canonicalToOpencodeV2Matcher({
              matcher: def.matcher,
              eventName: canonicalEvent,
              logger,
            }),
          }
        : {}),
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
}: {
  hookHandlers: Map<string, V2Handler[]>;
  eventHandlers: Map<string, V2Handler[]>;
}): string[] {
  if (hookHandlers.size === 0 && eventHandlers.size === 0) return [];

  const body: string[] = [
    "const directory = ctx.location?.directory ?? process.cwd();",
    "",
    ...buildRunHelperLines({
      handlers: [...hookHandlers.values(), ...eventHandlers.values()].flat(),
      cwdExpression: "directory",
    }),
  ];
  const usesMatcher = [...hookHandlers.values()].some((handlers) =>
    handlers.some((handler) => handler.matcher !== undefined),
  );
  if (usesMatcher) {
    body.push("", ...TOOL_MATCHER_HELPER_LINES);
  }
  const usesContext = [...eventHandlers.values()].some(usesSessionContext);
  const registers = hookHandlers.size > 0 || usesContext;
  const cleanup: string[] = [];
  if (registers) {
    body.push("", "const __rulesyncRegistrations = [];");
    for (const [hookPoint, handlers] of hookHandlers) {
      body.push(...buildHookRegistrationLines(hookPoint, handlers));
    }
    if (usesContext) body.push(...SESSION_CONTEXT_HOOK_LINES);
  }
  if (eventHandlers.size > 0) {
    body.push("", ...buildEventLoopLines(eventHandlers, usesContext));
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

  // Keyed by `<domain>:<name>` hook point and by event type respectively, in
  // first-seen order.
  const hookHandlers = new Map<string, V2Handler[]>();
  const eventHandlers = new Map<string, V2Handler[]>();

  for (const [canonicalEvent, definitions] of Object.entries(configHooks)) {
    if (!supported.has(canonicalEvent)) continue;
    const target = eventMap[canonicalEvent];
    if (!target) continue;
    const handlers = buildHandlersFor({ canonicalEvent, definitions, target, logger });
    if (handlers.length === 0) continue;
    const isEvent = target.startsWith("event:");
    const key = isEvent ? target.slice("event:".length) : target;
    const group = isEvent ? eventHandlers : hookHandlers;
    group.set(key, [...(group.get(key) ?? []), ...handlers]);
  }

  const body = buildSetupBodyLines({ hookHandlers, eventHandlers });
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
