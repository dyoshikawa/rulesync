// cspell:ignore nothrow -- Bun Shell API
import { HooksConfig } from "../../types/hooks.js";
import {
  escapeForTemplateLiteral,
  PRE_TOOL_USE_RESULT_HELPER,
  PRE_TOOL_USE_RESULT_HELPER_LINES,
  validateAndSanitizeMatcher,
} from "./opencode-style-generator.js";

/**
 * Generator for the OpenCode V2 (OpenCode 2.x) hooks plugin.
 *
 * OpenCode 2.x no longer runs V1 plugin modules: a plugin must default-export
 * `{ id, setup(ctx) }`. Inside `setup` hooks are registered per domain
 * (`await ctx.tool.hook("execute.before", handler)`), and lifecycle events
 * are read from `ctx.event.subscribe({ signal })`, an async iterable of the
 * public event stream whose payload lives under `event.data`.
 *
 * Commands run through a private Bun Shell instance (`new Bun.$.Shell()`, the
 * plugin runs inside the Bun-built OpenCode binary) whose working directory is
 * the plugin location's directory, so the global `Bun.$` defaults other
 * plugins see are left alone.
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
 * Canonical events whose command receives a Claude Code-style `PreToolUse`
 * JSON payload on stdin and whose result can deny the call. Throwing from an
 * `execute.before` hook fails the tool call with the error message, which the
 * model sees — the same contract the V1 plugin implements, interpreted by the
 * shared `PRE_TOOL_USE_RESULT_HELPER`.
 */
const OPENCODE_V2_STDIN_PAYLOAD_EVENTS: Record<string, string> = {
  preToolUse: "PreToolUse",
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

type V2Handler = {
  command: string;
  matcher?: string;
  gate?: string;
  stdinEvent?: string;
};

function stdinPayloadVariable(stdinEvent: string): string {
  return `__rulesync${stdinEvent}Input`;
}

function buildRunStatement(handler: V2Handler): string {
  const escapedCommand = escapeForTemplateLiteral(handler.command);
  if (handler.stdinEvent) {
    const payload = stdinPayloadVariable(handler.stdinEvent);
    return `${PRE_TOOL_USE_RESULT_HELPER}(await $\`echo \${${payload}()} | ${escapedCommand}\`.nothrow().quiet());`;
  }
  return `await $\`${escapedCommand}\`;`;
}

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
  // Serialized at most once per invocation, by the first handler that runs.
  // `stdinEvent` only ever holds a value from the payload table, never user
  // input, so it is safe to emit as an identifier suffix and a string.
  const stdinEvents = [
    ...new Set(handlers.flatMap((handler) => (handler.stdinEvent ? [handler.stdinEvent] : []))),
  ];
  for (const stdinEvent of stdinEvents) {
    const payload = stdinPayloadVariable(stdinEvent);
    lines.push(`    let ${payload}Cache;`);
    lines.push(`    const ${payload} = () =>`);
    lines.push(`      (${payload}Cache ??= JSON.stringify({`);
    lines.push(`        hook_event_name: "${stdinEvent}",`);
    lines.push("        session_id: event.sessionID,");
    lines.push("        tool_use_id: event.id,");
    lines.push("        tool_name: event.tool,");
    lines.push("        tool_input: event.input,");
    lines.push("        cwd: directory,");
    lines.push("      }));");
  }
  for (const handler of handlers) {
    lines.push(...wrapInConditions(handler, buildRunStatement(handler), "    "));
  }
  lines.push("  }),");
  lines.push(");");
  return lines;
}

/**
 * Emit the event-stream loop. Each command is isolated in its own try/catch so
 * a failing hook neither skips its siblings nor ends the subscription.
 */
function buildEventLoopLines(eventHandlers: Map<string, V2Handler[]>): string[] {
  const lines: string[] = [];
  lines.push("const __rulesyncEvents = new AbortController();");
  lines.push("void (async () => {");
  lines.push(
    "  for await (const event of ctx.event.subscribe({ signal: __rulesyncEvents.signal })) {",
  );
  let isFirst = true;
  for (const [eventType, handlers] of eventHandlers) {
    lines.push(`    ${isFirst ? "if" : "} else if"} (event.type === "${eventType}") {`);
    isFirst = false;
    for (const handler of handlers) {
      lines.push("      try {");
      lines.push(...wrapInConditions(handler, buildRunStatement(handler), "        "));
      lines.push("      } catch (error) {");
      lines.push(`        console.error("[rulesync-hooks] ${eventType} hook failed:", error);`);
      lines.push("      }");
    }
  }
  lines.push("    }");
  lines.push("  }");
  lines.push("})().catch(() => {});");
  return lines;
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
  const stdinEvent = OPENCODE_V2_STDIN_PAYLOAD_EVENTS[canonicalEvent];
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
      ...(def.matcher ? { matcher: def.matcher } : {}),
      ...(gate ? { gate } : {}),
      ...(stdinEvent ? { stdinEvent } : {}),
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
  const usesStdinPayload = [...hookHandlers.values()].some((handlers) =>
    handlers.some((handler) => handler.stdinEvent !== undefined),
  );

  const body: string[] = [
    "const directory = ctx.location?.directory ?? process.cwd();",
    "const $ = new Bun.$.Shell();",
    "$.cwd(directory);",
  ];
  // The deny-aware result helper is defined only when a handler uses it.
  if (usesStdinPayload) {
    body.push("", ...PRE_TOOL_USE_RESULT_HELPER_LINES);
  }
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
  lines.push('  id: "rulesync-hooks",');
  lines.push(`  setup: async (${body.length > 0 ? "ctx" : ""}) => {`);
  for (const line of body) {
    lines.push(line === "" ? "" : `    ${line}`);
  }
  lines.push("  },");
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}
