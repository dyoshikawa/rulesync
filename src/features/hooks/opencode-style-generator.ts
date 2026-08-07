import { HooksConfig, CONTROL_CHARS } from "../../types/hooks.js";

/**
 * Tool events emitted as named `(input, ...)` hooks rather than through the
 * generic `event.type` dispatch, mapped to the expression a hook's `matcher`
 * regex is tested against — or `null` when the hook has no matchable subject,
 * in which case a matcher is dropped rather than compiled against a field that
 * does not exist.
 *
 * `experimental.session.compacting` receives `(input, output)` and exposes no
 * per-invocation identifier worth matching on, so it takes `null`.
 * `chat.message` receives `(input, output)` with the prompt text living in
 * `output.parts` rather than a single matchable field, so it takes `null` too.
 *
 * @see https://opencode.ai/docs/plugins/
 */
const NAMED_HOOK_MATCHER_SUBJECTS: Record<string, string | null> = {
  "tool.execute.before": "input.tool",
  "tool.execute.after": "input.tool",
  "experimental.session.compacting": null,
  "chat.message": null,
};

/**
 * Canonical events whose generic (`event.type`) dispatch fires more broadly
 * than the canonical event means, mapped to the extra condition the generated
 * handler gates on. Keyed by canonical event like `SHELL_EVENT_TOOL_GATES`, so
 * a second canonical event mapped onto the same dispatch does not inherit a
 * gate meant for its sibling.
 *
 * `permission.replied` fires for every reply — `once`, `always` and `reject` —
 * so the canonical `permissionDenied` handler runs only for a rejecting reply.
 *
 * Note the v1 SDK's generated `Event` typing still describes this payload as
 * `{ permissionID, response }`; the schema source, the v2 typings and the TUI's
 * live consumer all agree on `{ requestID, reply }`, so the stale codegen is
 * not followed here.
 *
 * @see https://opencode.ai/docs/plugins/
 */
const GENERIC_EVENT_PROPERTY_GATES: Record<string, string> = {
  permissionDenied: 'event.properties.reply === "reject"',
};

/**
 * OpenCode (and Kilo) have no shell-execution lifecycle event — the
 * `command.executed` event these canonical events were once mapped to is a
 * *slash-command* event, so a hook wired there never fired on bash commands
 * and fired on every slash command instead. Observing a shell invocation is
 * done with the named `tool.execute.before/after` hooks gated on the `bash`
 * tool (the `.env protection` pattern in the OpenCode plugins doc), so these
 * canonical events are emitted into those named hooks with an implicit
 * `input.tool === "bash"` gate. Matchers on them are dropped upstream with a
 * warning (`matcherEvents` covers only `preToolUse`/`postToolUse`) — the
 * named hooks expose no command text to match against.
 *
 * @see https://opencode.ai/docs/plugins/
 */
const SHELL_EVENT_TOOL_GATES: Record<string, { toolEvent: string; tool: string }> = {
  beforeShellExecution: { toolEvent: "tool.execute.before", tool: "bash" },
  afterShellExecution: { toolEvent: "tool.execute.after", tool: "bash" },
};

function escapeForTemplateLiteral(command: string): string {
  return command.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function validateAndSanitizeMatcher(matcher: string): string {
  let sanitized = matcher;
  for (const char of CONTROL_CHARS) {
    sanitized = sanitized.replaceAll(char, "");
  }
  if (sanitized === "*") {
    sanitized = ".*";
  }
  try {
    new RegExp(sanitized);
  } catch {
    throw new Error(`Invalid regex pattern in hook matcher: ${sanitized}`);
  }
  return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type Handler = { command: string; matcher?: string; toolGate?: string; propertyGate?: string };
type HandlerGroup = Record<string, Handler[]>;

/**
 * Group the effective hooks into named (tool.execute.*) and generic event
 * handler groups, keyed by tool event name. Mutates the supplied groups.
 */
function collectOpencodeStyleHandlers({
  effectiveHooks,
  eventMap,
  namedEventHandlers,
  genericEventHandlers,
}: {
  effectiveHooks: HooksConfig["hooks"];
  eventMap: Record<string, string>;
  namedEventHandlers: HandlerGroup;
  genericEventHandlers: HandlerGroup;
}): void {
  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    const shellGate = SHELL_EVENT_TOOL_GATES[canonicalEvent];
    const propertyGate = GENERIC_EVENT_PROPERTY_GATES[canonicalEvent];
    const toolEvent = shellGate?.toolEvent ?? eventMap[canonicalEvent];
    if (!toolEvent) continue;

    // Matchers are honored only on the named hooks with a matchable subject
    // (`tool.execute.*` via `input.tool`). Everywhere else — the bash-gated
    // shell events, the subject-less `experimental.session.compacting`, and
    // the generic `event.type` dispatches — there is nothing to test the regex
    // against, so a matcher-carrying definition is skipped here to match the
    // "Skipped matcher hook(s)" warning the processor already emitted.
    const matcherSupported =
      !shellGate &&
      Object.hasOwn(NAMED_HOOK_MATCHER_SUBJECTS, toolEvent) &&
      NAMED_HOOK_MATCHER_SUBJECTS[toolEvent] !== null;

    const handlers: Handler[] = [];
    for (const def of definitions) {
      if ((def.type ?? "command") !== "command") continue;
      if (!def.command) continue;
      if (def.matcher && !matcherSupported) continue;
      handlers.push({
        command: def.command,
        matcher: def.matcher ? def.matcher : undefined,
        ...(shellGate ? { toolGate: shellGate.tool } : {}),
        ...(propertyGate ? { propertyGate } : {}),
      });
    }

    if (handlers.length > 0) {
      const grouped = Object.hasOwn(NAMED_HOOK_MATCHER_SUBJECTS, toolEvent)
        ? namedEventHandlers
        : genericEventHandlers;
      const existing = grouped[toolEvent];
      if (existing) {
        existing.push(...handlers);
      } else {
        grouped[toolEvent] = handlers;
      }
    }
  }
}

/** Emit the `event: async ({ event }) => {...}` block for generic handlers. */
function buildGenericEventBodyLines(genericEventHandlers: HandlerGroup): string[] {
  const bodyLines: string[] = [];
  if (Object.keys(genericEventHandlers).length === 0) {
    return bodyLines;
  }
  bodyLines.push("    event: async ({ event }) => {");
  let isFirst = true;
  for (const [eventName, handlers] of Object.entries(genericEventHandlers)) {
    bodyLines.push(`      ${isFirst ? "if" : "else if"} (event.type === "${eventName}") {`);
    isFirst = false;
    for (const handler of handlers) {
      const escapedCommand = escapeForTemplateLiteral(handler.command);
      if (handler.propertyGate) {
        // The dispatch fires more broadly than the canonical event it came
        // from, so this handler narrows it to the matching payload.
        bodyLines.push(`        if (${handler.propertyGate}) {`);
        bodyLines.push(`          await $\`${escapedCommand}\`;`);
        bodyLines.push("        }");
      } else {
        bodyLines.push(`        await $\`${escapedCommand}\`;`);
      }
    }
    bodyLines.push("      }");
  }
  bodyLines.push("    },");
  return bodyLines;
}

/** Emit the named (`tool.execute.*`) handler blocks. */
function buildNamedEventBodyLines(namedEventHandlers: HandlerGroup): string[] {
  const bodyLines: string[] = [];
  for (const [eventName, handlers] of Object.entries(namedEventHandlers)) {
    const matcherSubject = NAMED_HOOK_MATCHER_SUBJECTS[eventName] ?? null;
    bodyLines.push(`    "${eventName}": async (input) => {`);
    for (const handler of handlers) {
      const escapedCommand = escapeForTemplateLiteral(handler.command);
      if (handler.toolGate) {
        // Shell-event handler: fires only for the gated tool's executions.
        bodyLines.push(`      if (input.tool === "${handler.toolGate}") {`);
        bodyLines.push(`        await $\`${escapedCommand}\`;`);
        bodyLines.push("      }");
      } else if (handler.matcher && matcherSubject !== null) {
        const safeMatcher = validateAndSanitizeMatcher(handler.matcher);
        bodyLines.push("      {");
        bodyLines.push(`        const __re = new RegExp("${safeMatcher}");`);
        bodyLines.push(`        if (__re.test(${matcherSubject})) {`);
        bodyLines.push(`          await $\`${escapedCommand}\`;`);
        bodyLines.push("        }");
        bodyLines.push("      }");
      } else {
        bodyLines.push(`      await $\`${escapedCommand}\`;`);
      }
    }
    bodyLines.push("    },");
  }
  return bodyLines;
}

/** Wrap the handler body lines in the requested export shape. */
function wrapInExportShape({
  bodyLines,
  exportStyle,
}: {
  bodyLines: string[];
  exportStyle: "named" | "default";
}): string[] {
  const lines: string[] = [];
  if (exportStyle === "default") {
    lines.push("export default {");
    lines.push('  id: "rulesync-hooks",');
    lines.push("  server: async ({ $ }) => {");
    lines.push("    return {");
    // Indent the handler entries by an extra two spaces to account for the
    // additional `server` function nesting level. Blank lines stay empty.
    for (const line of bodyLines) {
      lines.push(line === "" ? "" : `  ${line}`);
    }
    lines.push("    };");
    lines.push("  },");
    lines.push("};");
  } else {
    lines.push("export const RulesyncHooksPlugin = async ({ $ }) => {");
    lines.push("  return {");
    lines.push(...bodyLines);
    lines.push("  };");
    lines.push("};");
  }
  lines.push("");
  return lines;
}

export function generateOpencodeStylePluginCode(
  config: HooksConfig,
  supportedEvents: readonly string[],
  toolConfigKey: "kilo" | "opencode",
  eventMap: Record<string, string>,
  // Export shape of the generated plugin module:
  // - "named" (default): `export const RulesyncHooksPlugin = async ({ $ }) => {...}`
  //   — the OpenCode convention.
  // - "default": `export default { id: "rulesync-hooks", server: async ({ $ }) => {...} }`
  //   — Kilo's canonical `{ id, server }` module descriptor. Kilo marks named
  //   exports as legacy, so the Kilo target emits this form.
  //   https://kilo.ai/docs/automate/extending/plugins
  exportStyle: "named" | "default" = "named",
): string {
  const supported: Set<string> = new Set(supportedEvents);
  const configHooks = { ...config.hooks, ...config[toolConfigKey]?.hooks };
  const effectiveHooks: HooksConfig["hooks"] = {};

  for (const [event, defs] of Object.entries(configHooks)) {
    if (supported.has(event)) effectiveHooks[event] = defs;
  }

  const namedEventHandlers: HandlerGroup = {};
  const genericEventHandlers: HandlerGroup = {};

  collectOpencodeStyleHandlers({
    effectiveHooks,
    eventMap,
    namedEventHandlers,
    genericEventHandlers,
  });

  // Build the handler entries (the contents of the returned object) once with a
  // base indentation, then wrap them in the requested export shape. The default
  // (Kilo) export nests the function one level deeper, so its body is re-indented
  // by an extra two spaces relative to the named (OpenCode) export.
  const bodyLines: string[] = [
    ...buildGenericEventBodyLines(genericEventHandlers),
    ...buildNamedEventBodyLines(namedEventHandlers),
  ];

  const lines = wrapInExportShape({ bodyLines, exportStyle });

  return lines.join("\n");
}
