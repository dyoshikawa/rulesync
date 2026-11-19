import { HooksConfig } from "../../types/hooks.js";
import {
  buildPayloadClosureLines,
  buildRunHelperLines,
  buildRunStatement,
  hookTimingOf,
  type RunnableHandler,
  type StdinPayload,
  validateAndSanitizeMatcher,
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
 */
function buildEventLoopLines(eventHandlers: Map<string, V2Handler[]>): string[] {
  const lines: string[] = [];
  // Event types come from the internal event map, never from user input.
  const types = [...eventHandlers.keys()].map((eventType) => JSON.stringify(eventType)).join(", ");
  lines.push("const __rulesyncEvents = new AbortController();");
  lines.push("void (async () => {");
  lines.push("  for await (const event of ctx.event.subscribe({");
  lines.push(`    types: [${types}],`);
  lines.push("    signal: __rulesyncEvents.signal,");
  lines.push("  })) {");
  let isFirst = true;
  for (const [eventType, handlers] of eventHandlers) {
    lines.push(`    ${isFirst ? "if" : "} else if"} (event.type === "${eventType}") {`);
    isFirst = false;
    lines.push(
      ...buildPayloadClosureLines({ handlers, cwdExpression: "directory" }).map(
        (line) => `      ${line}`,
      ),
    );
    for (const handler of handlers) {
      lines.push("      try {");
      lines.push(...wrapInConditions(handler, buildRunStatement(handler), "        "));
      lines.push("      } catch (error) {");
      const message = JSON.stringify(`[rulesync-hooks] ${handler.event} hook failed:`);
      lines.push(`        console.error(${message}, error);`);
      lines.push("      }");
    }
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
}: {
  canonicalEvent: string;
  definitions: HooksConfig["hooks"][string];
  target: string;
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
      ...(def.matcher ? { matcher: def.matcher } : {}),
      ...(gate ? { gate } : {}),
      ...(payload ? { payload } : {}),
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
  const cleanup: string[] = [];
  if (hookHandlers.size > 0) {
    body.push("", "const __rulesyncRegistrations = [];");
    for (const [hookPoint, handlers] of hookHandlers) {
      body.push(...buildHookRegistrationLines(hookPoint, handlers));
    }
  }
  if (eventHandlers.size > 0) {
    body.push("", ...buildEventLoopLines(eventHandlers));
    cleanup.push("  __rulesyncEvents.abort();");
  }
  if (hookHandlers.size > 0) {
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
}: {
  config: HooksConfig;
  supportedEvents: readonly string[];
  toolConfigKey: "opencode" | "opencodev1" | "mimocode";
  eventMap: Record<string, string>;
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
    const handlers = buildHandlersFor({ canonicalEvent, definitions, target });
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
