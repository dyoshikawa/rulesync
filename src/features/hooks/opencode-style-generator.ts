// cspell:ignore nothrow subshell redirections -- Bun Shell API and shell terms
import { HooksConfig, CONTROL_CHARS } from "../../types/hooks.js";
import { buildBlockReasonSanitizerLines } from "./hook-block-reason.js";

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
 * `chat.params` receives the agent, model and provider objects of an LLM
 * request but no tool name or command to match on, so it takes `null` as well.
 * `command.execute.before` fires only for slash commands and receives the
 * command name as `input.command`, which a matcher is tested against — the
 * same subject Claude Code's `UserPromptExpansion` matcher filters on.
 *
 * @see https://opencode.ai/docs/plugins/
 */
const NAMED_HOOK_MATCHER_SUBJECTS: Record<string, string | null> = {
  "tool.execute.before": "input.tool",
  "tool.execute.after": "input.tool",
  "experimental.session.compacting": null,
  "chat.message": null,
  "chat.params": null,
  "command.execute.before": "input.command",
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
 * warning (`OPENCODE_MATCHER_HOOK_EVENTS` leaves them out) — the
 * named hooks expose no command text to match against.
 *
 * @see https://opencode.ai/docs/plugins/
 */
const SHELL_EVENT_TOOL_GATES: Record<string, { toolEvent: string; tool: string }> = {
  beforeShellExecution: { toolEvent: "tool.execute.before", tool: "bash" },
  afterShellExecution: { toolEvent: "tool.execute.after", tool: "bash" },
};

/**
 * Canonical events whose command receives a Claude Code-style JSON payload on
 * stdin and whose result can deny the call, mapped to the `hook_event_name`
 * the payload carries. Only `preToolUse` (`tool.execute.before`) takes part:
 * it is the one named hook where throwing aborts the call — OpenCode rejects
 * the tool call and returns the error message to the model (the `.env`
 * protection example in the plugins doc).
 *
 * The payload mirrors Claude Code's `PreToolUse` input: `hook_event_name`,
 * `session_id` (`input.sessionID`), `tool_use_id` (`input.callID`),
 * `tool_name` (the raw OpenCode tool name — `bash`, `edit`, `<server>_<tool>`
 * for MCP — the same subject a `matcher` is tested against), `tool_input`
 * (`output.args`) and `cwd` (the plugin context's `directory`, falling back to
 * `process.cwd()`). It is serialized lazily, on the first handler whose
 * matcher matches, so a tool call no hook applies to pays nothing for it.
 *
 * Bun Shell has no stdin option on a command and rejects redirections on a
 * subshell, so the payload is piped in by the shell's builtin `echo`
 * (`echo ${payload} | <command>`); Bun escapes the interpolated value, so the
 * payload never reaches the shell as syntax. The pipe feeds the first
 * pipeline of the command — a compound `a && b` or `a; b` gives the payload
 * to `a` only, so multi-step guards belong in a script.
 *
 * @see https://opencode.ai/docs/plugins/
 * @see https://bun.sh/docs/runtime/shell
 * @see https://code.claude.com/docs/en/hooks
 */
const STDIN_PAYLOAD_EVENTS: Record<string, string> = {
  preToolUse: "PreToolUse",
};

/**
 * Name of the helper the generated plugin defines when a `preToolUse` handler
 * is present. It interprets the command's result like Claude Code does for a
 * `PreToolUse` hook, throwing (which aborts the OpenCode tool call) when the
 * hook denies it:
 * - exit code 2 → deny, with the command's stderr as the reason;
 * - exit code 0 with JSON stdout whose `hookSpecificOutput.permissionDecision`
 *   is `"deny"` → deny, with `permissionDecisionReason` as the reason;
 * - exit code 0 otherwise → allow;
 * - any other non-zero exit → deny too, with stderr or the exit code.
 *
 * Every reason goes through the `sanitizeBlockReason` helper shared with the
 * Pi extension (`hook-block-reason.ts`): control and format characters are
 * stripped and the text is capped at 2000 characters before the model sees it.
 *
 * The other non-zero exit case is deliberate. Claude Code treats that as a
 *   non-blocking error, but before this payload contract existed the plugin
 *   ran the command through Bun Shell's default throwing mode, so every
 *   non-zero exit aborted the call. Keeping that preserves guards that block
 *   with `exit 1`, rather than silently failing them open.
 */
export const PRE_TOOL_USE_RESULT_HELPER = "__rulesyncEnforcePreToolUseResult";

export const PRE_TOOL_USE_RESULT_HELPER_LINES: readonly string[] = [
  ...buildBlockReasonSanitizerLines({ typed: false }),
  "",
  `const ${PRE_TOOL_USE_RESULT_HELPER} = (result) => {`,
  "  const stderr = result.stderr.toString();",
  "  if (result.exitCode === 0) {",
  "    let parsed;",
  "    try {",
  "      parsed = JSON.parse(result.stdout.toString());",
  "    } catch {",
  "      return;",
  "    }",
  '    const specific = parsed && typeof parsed === "object" ? parsed.hookSpecificOutput : undefined;',
  '    if (specific && typeof specific === "object" && specific.permissionDecision === "deny") {',
  "      throw new Error(",
  '        (typeof specific.permissionDecisionReason === "string" &&',
  "          sanitizeBlockReason(specific.permissionDecisionReason)) ||",
  '          "Blocked by a preToolUse hook.",',
  "      );",
  "    }",
  "    return;",
  "  }",
  "  if (result.exitCode === 2) {",
  '    throw new Error(sanitizeBlockReason(stderr) || "Blocked by a preToolUse hook.");',
  "  }",
  "  throw new Error(",
  "    sanitizeBlockReason(stderr) ||",
  '      "preToolUse hook command failed with exit code " + result.exitCode + ".",',
  "  );",
  "};",
];

export function escapeForTemplateLiteral(command: string): string {
  return command.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export function validateAndSanitizeMatcher(matcher: string): string {
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

type Handler = {
  command: string;
  matcher?: string;
  toolGate?: string;
  propertyGate?: string;
  /** `hook_event_name` of the stdin payload; set only for `STDIN_PAYLOAD_EVENTS`. */
  stdinEvent?: string;
};
type HandlerGroup = Record<string, Handler[]>;

/** The per-canonical-event gates and payload flag every handler of it carries. */
function handlerExtrasFor(
  canonicalEvent: string,
): Pick<Handler, "toolGate" | "propertyGate" | "stdinEvent"> {
  const shellGate = SHELL_EVENT_TOOL_GATES[canonicalEvent];
  const propertyGate = GENERIC_EVENT_PROPERTY_GATES[canonicalEvent];
  const stdinEvent = shellGate ? undefined : STDIN_PAYLOAD_EVENTS[canonicalEvent];
  return {
    ...(shellGate ? { toolGate: shellGate.tool } : {}),
    ...(propertyGate ? { propertyGate } : {}),
    ...(stdinEvent ? { stdinEvent } : {}),
  };
}

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
    const extras = handlerExtrasFor(canonicalEvent);
    const toolEvent = shellGate?.toolEvent ?? eventMap[canonicalEvent];
    if (!toolEvent) continue;

    // Matchers are honored only on the named hooks with a matchable subject
    // (`tool.execute.*` via `input.tool`, `command.execute.before` via
    // `input.command`). Everywhere else — the bash-gated
    // shell events, the subject-less named hooks, and
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
        ...extras,
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

function stdinPayloadVariable(stdinEvent: string): string {
  return `__rulesync${stdinEvent}Input`;
}

/**
 * The statement that runs a handler's command. A handler with a stdin payload
 * pipes the payload in and hands the result to the deny-aware helper; every
 * other handler keeps Bun Shell's default mode, where a non-zero exit throws.
 */
function buildRunStatement(handler: Handler): string {
  const escapedCommand = escapeForTemplateLiteral(handler.command);
  if (handler.stdinEvent) {
    const payload = stdinPayloadVariable(handler.stdinEvent);
    return `${PRE_TOOL_USE_RESULT_HELPER}(await $\`echo \${${payload}()} | ${escapedCommand}\`.nothrow().quiet());`;
  }
  return `await $\`${escapedCommand}\`;`;
}

/** Emit the named (`tool.execute.*`) handler blocks. */
function buildNamedEventBodyLines(namedEventHandlers: HandlerGroup): string[] {
  const bodyLines: string[] = [];
  for (const [eventName, handlers] of Object.entries(namedEventHandlers)) {
    const matcherSubject = NAMED_HOOK_MATCHER_SUBJECTS[eventName] ?? null;
    const stdinEvents = [
      ...new Set(handlers.flatMap((handler) => (handler.stdinEvent ? [handler.stdinEvent] : []))),
    ];
    bodyLines.push(
      `    "${eventName}": async (${stdinEvents.length > 0 ? "input, output" : "input"}) => {`,
    );
    // Serialized at most once per invocation, by the first handler that runs.
    // `stdinEvent` only ever holds a value from `STDIN_PAYLOAD_EVENTS`, never
    // user input, so it is safe to emit as an identifier suffix and a string.
    for (const stdinEvent of stdinEvents) {
      const payload = stdinPayloadVariable(stdinEvent);
      bodyLines.push(`      let ${payload}Cache;`);
      bodyLines.push(`      const ${payload} = () =>`);
      bodyLines.push(`        (${payload}Cache ??= JSON.stringify({`);
      bodyLines.push(`          hook_event_name: "${stdinEvent}",`);
      bodyLines.push("          session_id: input.sessionID,");
      bodyLines.push("          tool_use_id: input.callID,");
      bodyLines.push("          tool_name: input.tool,");
      bodyLines.push("          tool_input: output?.args,");
      bodyLines.push("          cwd: directory ?? process.cwd(),");
      bodyLines.push("        }));");
    }
    for (const handler of handlers) {
      const runStatement = buildRunStatement(handler);
      if (handler.toolGate) {
        // Shell-event handler: fires only for the gated tool's executions.
        bodyLines.push(`      if (input.tool === "${handler.toolGate}") {`);
        bodyLines.push(`        ${runStatement}`);
        bodyLines.push("      }");
      } else if (handler.matcher && matcherSubject !== null) {
        const safeMatcher = validateAndSanitizeMatcher(handler.matcher);
        bodyLines.push("      {");
        bodyLines.push(`        const __re = new RegExp("${safeMatcher}");`);
        bodyLines.push(`        if (__re.test(${matcherSubject})) {`);
        bodyLines.push(`          ${runStatement}`);
        bodyLines.push("        }");
        bodyLines.push("      }");
      } else {
        bodyLines.push(`      ${runStatement}`);
      }
    }
    bodyLines.push("    },");
  }
  return bodyLines;
}

/** Wrap the handler body lines in the requested export shape. */
function wrapInExportShape({
  preambleLines,
  bodyLines,
  exportStyle,
}: {
  preambleLines: readonly string[];
  bodyLines: string[];
  exportStyle: "named" | "default";
}): string[] {
  // `directory` (the session's working directory, in both the OpenCode and the
  // Kilo plugin context) is only read by the stdin payload, so plugins without
  // one keep destructuring `$` alone.
  const pluginContextPattern = preambleLines.length > 0 ? "{ $, directory }" : "{ $ }";
  const lines: string[] = [];
  if (exportStyle === "default") {
    lines.push("export default {");
    lines.push('  id: "rulesync-hooks",');
    lines.push(`  server: async (${pluginContextPattern}) => {`);
    for (const line of preambleLines) {
      lines.push(line === "" ? "" : `    ${line}`);
    }
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
    lines.push(`export const RulesyncHooksPlugin = async (${pluginContextPattern}) => {`);
    for (const line of preambleLines) {
      lines.push(line === "" ? "" : `  ${line}`);
    }
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
  toolConfigKey: "kilo" | "mimocode" | "opencode" | "opencodev1",
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

  // The deny-aware result helper is defined once in the plugin function body,
  // and only when a handler uses it, so plugins without a stdin-payload hook
  // stay byte-for-byte unchanged.
  const usesStdinPayload = Object.values(namedEventHandlers).some((handlers) =>
    handlers.some((handler) => handler.stdinEvent !== undefined),
  );
  const preambleLines = usesStdinPayload ? PRE_TOOL_USE_RESULT_HELPER_LINES : [];

  const lines = wrapInExportShape({ preambleLines, bodyLines, exportStyle });

  return lines.join("\n");
}
