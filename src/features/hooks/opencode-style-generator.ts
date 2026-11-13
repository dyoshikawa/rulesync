// cspell:ignore nothrow -- Bun Shell API
import { HooksConfig } from "../../types/hooks.js";
import { buildBlockReasonSanitizerLines } from "./hook-block-reason.js";
import { sanitizeMatcherRegex } from "./hook-matcher-regex.js";

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
 * Canonical events whose command receives Claude Code's JSON input for the
 * event on stdin (every other command gets an empty stdin), with the fields
 * besides `hook_event_name` and `cwd`. `tool_name` is the raw OpenCode tool
 * name, the subject a `matcher` is tested against. A payload is serialized
 * lazily, once per invocation, by the first handler that runs.
 *
 * @see https://opencode.ai/docs/plugins/
 * @see https://bun.sh/docs/runtime/shell
 * @see https://code.claude.com/docs/en/hooks
 */
const STDIN_PAYLOADS: Record<string, StdinPayload> = {
  preToolUse: {
    name: "PreToolUse",
    fields: [
      "session_id: input.sessionID",
      "tool_use_id: input.callID",
      "tool_name: input.tool",
      "tool_input: output?.args",
    ],
  },
  postToolUse: {
    name: "PostToolUse",
    fields: [
      "session_id: input.sessionID",
      "tool_use_id: input.callID",
      "tool_name: input.tool",
      "tool_input: input.args",
      "tool_response: output",
    ],
  },
  stop: { name: "Stop", fields: ["session_id: event.properties?.sessionID"] },
};

/**
 * V1 hooks that run before the action they belong to — every named hook but
 * `tool.execute.after`: like the Bun Shell call earlier versions emitted, a
 * failing command throws there, which aborts the action. Everywhere else a
 * failure is only logged.
 */
const BLOCKING_HOOKS: ReadonlySet<string> = new Set(
  Object.keys(NAMED_HOOK_MATCHER_SUBJECTS).filter((hook) => hook !== "tool.execute.after"),
);

/**
 * Helpers of every plugin with a handler. Bun Shell cannot give a command a
 * stdin of its own, and one that inherits OpenCode's (the TTY, or the pipe of
 * `opencode serve --stdio`) blocks forever once any part of it reads stdin. So
 * `__rulesyncRunCommand` runs the command in the host's own Bun-compiled binary
 * as the Bun CLI (`BUN_BE_BUN=1`, without the project's `.env`): `exec` runs it
 * with the same Bun Shell, parsing the text the template literal of earlier
 * versions held, with the payload as stdin. The script clears `BUN_BE_BUN` for
 * the programs the command starts. A host without the Bun CLI fails the probe
 * and falls back to Bun Shell, piping the payload into the first command only
 * (a probe its 10 s limit cut short is retried on the next command). Output
 * pipes a background process keeps open are read for 1 s after the command
 * exits; what arrived by then is kept. The OpenCode 1.x-style `event` hooks
 * (`inProcess`) take the Bun Shell path too: starting the child takes about
 * 250 ms, and OpenCode 1.x's one-shot `opencode run` exits right after
 * `session.idle`, before a `stop` command run that way could start.
 * `__rulesyncRunHook` echoes the output, as Bun Shell did, and on a failure
 * throws in a blocking hook or logs it otherwise.
 *
 * @see https://bun.sh/docs/bundler/executables
 */
function buildRunHelperLinesFor(cwdExpression: string): string[] {
  const spawn = ({ script, stdin }: { script: string; stdin: string }) =>
    `Bun.spawn([process.execPath, "--no-env-file", "exec", ${script}], { cwd: ${cwdExpression}, env: { ...process.env, BUN_BE_BUN: "1" }, stdin: ${stdin}, stdout: "pipe", stderr: "pipe", windowsHide: true })`;
  return [
    "const __rulesyncRead = (stream) => {",
    "  const chunks = [];",
    "  const done = (async () => {",
    "    for await (const chunk of stream) chunks.push(chunk);",
    "  })().catch(() => {});",
    "  return { done, text: () => Buffer.concat(chunks).toString() };",
    "};",
    "let __rulesyncCanExec;",
    "const __rulesyncRunCommand = async ({ command, input, inProcess = false }) => {",
    "  if (!inProcess) __rulesyncCanExec ??= (async () => {",
    `    const probe = ${spawn({ script: '"echo rulesync"', stdin: '"ignore"' })};`,
    "    let killed = false;",
    "    const timer = setTimeout(() => ((killed = true), probe.kill()), 10000);",
    "    const output = __rulesyncRead(probe.stdout);",
    "    await Promise.all([output.done, probe.exited]);",
    "    clearTimeout(timer);",
    "    if (killed) __rulesyncCanExec = undefined;",
    '    return output.text().trim() === "rulesync";',
    "  })().catch(() => false);",
    "  if (inProcess || !(await __rulesyncCanExec)) {",
    `    const result = await Bun.$\`echo -n \${input} | \${{ raw: command }}\`.cwd(${cwdExpression}).nothrow().quiet();`,
    "    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };",
    "  }",
    `  const proc = ${spawn({ script: '"export BUN_BE_BUN=\\n" + command', stdin: "new TextEncoder().encode(input)" })};`,
    "  const [stdout, stderr] = [__rulesyncRead(proc.stdout), __rulesyncRead(proc.stderr)];",
    "  const exitCode = await proc.exited;",
    "  await Promise.race([Promise.all([stdout.done, stderr.done]), Bun.sleep(1000)]);",
    "  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };",
    "};",
    "const __rulesyncRunHook = async ({ label, command, input, blocking, inProcess = false }) => {",
    "  let result;",
    "  try {",
    "    result = await __rulesyncRunCommand({ command, input, inProcess });",
    "  } catch (error) {",
    "    if (blocking) throw error;",
    '    console.error("[rulesync-hooks] " + label + " hook failed:", error);',
    "    return;",
    "  }",
    "  process.stdout.write(result.stdout);",
    "  process.stderr.write(result.stderr);",
    "  if (result.exitCode === 0) return;",
    '  const message = "[rulesync-hooks] " + label + " hook exited with code " + result.exitCode;',
    "  if (blocking) throw new Error(message);",
    "  console.error(message);",
    "};",
  ];
}

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
const PRE_TOOL_USE_RESULT_HELPER = "__rulesyncEnforcePreToolUseResult";

const PRE_TOOL_USE_RESULT_HELPER_LINES: readonly string[] = [
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

function escapeForTemplateLiteral(command: string): string {
  return command.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export function validateAndSanitizeMatcher(matcher: string): string {
  const sanitized = sanitizeMatcherRegex(matcher);
  return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** A stdin payload: its `hook_event_name` and extra fields. */
export type StdinPayload = { name: string; fields: readonly string[] };

/** `event` labels log messages; `blocking` makes a failure abort the action. */
export type RunnableHandler = {
  command: string;
  event: string;
  blocking: boolean;
  inProcess?: boolean;
  payload?: StdinPayload;
};

type Handler = RunnableHandler & {
  matcher?: string;
  toolGate?: string;
  propertyGate?: string;
};
type HandlerGroup = Record<string, Handler[]>;

/** The per-canonical-event gates and payload every handler of it carries. */
function handlerExtrasFor(
  canonicalEvent: string,
): Pick<Handler, "event" | "toolGate" | "propertyGate" | "payload"> {
  const shellGate = SHELL_EVENT_TOOL_GATES[canonicalEvent];
  const propertyGate = GENERIC_EVENT_PROPERTY_GATES[canonicalEvent];
  const payload = shellGate ? undefined : STDIN_PAYLOADS[canonicalEvent];
  return {
    event: canonicalEvent,
    ...(shellGate ? { toolGate: shellGate.tool } : {}),
    ...(propertyGate ? { propertyGate } : {}),
    ...(payload ? { payload } : {}),
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
    const isNamedHook = Object.hasOwn(NAMED_HOOK_MATCHER_SUBJECTS, toolEvent);
    const matcherSupported =
      !shellGate && isNamedHook && NAMED_HOOK_MATCHER_SUBJECTS[toolEvent] !== null;

    const handlers: Handler[] = [];
    for (const def of definitions) {
      if ((def.type ?? "command") !== "command") continue;
      if (!def.command) continue;
      if (def.matcher && !matcherSupported) continue;
      handlers.push({
        command: def.command,
        matcher: def.matcher ? def.matcher : undefined,
        blocking: BLOCKING_HOOKS.has(toolEvent),
        inProcess: !isNamedHook,
        ...extras,
      });
    }

    if (handlers.length > 0) {
      const grouped = isNamedHook ? namedEventHandlers : genericEventHandlers;
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
    for (const line of buildPayloadClosureLines({ handlers, cwdExpression: V1_CWD_EXPRESSION })) {
      bodyLines.push(`        ${line}`);
    }
    for (const handler of handlers) {
      const runStatement = buildRunStatement(handler);
      if (handler.propertyGate) {
        // The dispatch fires more broadly than the canonical event it came
        // from, so this handler narrows it to the matching payload.
        bodyLines.push(`        if (${handler.propertyGate}) {`);
        bodyLines.push(`          ${runStatement}`);
        bodyLines.push("        }");
      } else {
        bodyLines.push(`        ${runStatement}`);
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

/** The `cwd` a V1 payload reports: the session directory, else the process's. */
const V1_CWD_EXPRESSION = "directory ?? process.cwd()";

/** Lazily serialized closures for the payloads the handlers use (internal tables only). */
export function buildPayloadClosureLines({
  handlers,
  cwdExpression,
}: {
  handlers: ReadonlyArray<{ payload?: StdinPayload }>;
  cwdExpression: string;
}): string[] {
  const payloads = new Map<string, StdinPayload>();
  for (const handler of handlers) {
    if (handler.payload) payloads.set(handler.payload.name, handler.payload);
  }
  const lines: string[] = [];
  for (const payload of payloads.values()) {
    const variable = stdinPayloadVariable(payload.name);
    lines.push(`let ${variable}Cache;`, `const ${variable} = () =>`);
    lines.push(`  (${variable}Cache ??= JSON.stringify({`);
    lines.push(`    hook_event_name: "${payload.name}",`);
    lines.push(...payload.fields.map((field) => `    ${field},`));
    lines.push(`    cwd: ${cwdExpression},`, "  }));");
  }
  return lines;
}

/**
 * The statement that runs a handler's command with its stdin payload, or an
 * empty stdin. The command keeps the escaping it had in the template literal
 * earlier versions emitted, so `bun exec` parses the same text.
 */
export function buildRunStatement(handler: RunnableHandler): string {
  const command = JSON.stringify(escapeForTemplateLiteral(handler.command));
  const input = handler.payload ? `${stdinPayloadVariable(handler.payload.name)}()` : '""';
  if (handler.payload?.name === "PreToolUse") {
    return `${PRE_TOOL_USE_RESULT_HELPER}(await __rulesyncRunCommand({ command: ${command}, input: ${input} }));`;
  }
  const options = [
    `label: ${JSON.stringify(handler.event)}`,
    `command: ${command}`,
    `input: ${input}`,
    `blocking: ${handler.blocking}`,
    ...(handler.inProcess ? ["inProcess: true"] : []),
  ];
  return `await __rulesyncRunHook({ ${options.join(", ")} });`;
}

/** The helpers a plugin body defines before its handlers, run in `cwdExpression`. */
export function buildRunHelperLines({
  handlers,
  cwdExpression,
}: {
  handlers: ReadonlyArray<RunnableHandler>;
  cwdExpression: string;
}): string[] {
  if (handlers.length === 0) return [];
  const usesPreToolUse = handlers.some((handler) => handler.payload?.name === "PreToolUse");
  return [
    ...buildRunHelperLinesFor(cwdExpression),
    ...(usesPreToolUse ? ["", ...PRE_TOOL_USE_RESULT_HELPER_LINES] : []),
  ];
}

/** Emit the named (`tool.execute.*`) handler blocks. */
function buildNamedEventBodyLines(namedEventHandlers: HandlerGroup): string[] {
  const bodyLines: string[] = [];
  for (const [eventName, handlers] of Object.entries(namedEventHandlers)) {
    const matcherSubject = NAMED_HOOK_MATCHER_SUBJECTS[eventName] ?? null;
    const payloadLines = buildPayloadClosureLines({ handlers, cwdExpression: V1_CWD_EXPRESSION });
    bodyLines.push(
      `    "${eventName}": async (${payloadLines.length > 0 ? "input, output" : "input"}) => {`,
    );
    bodyLines.push(...payloadLines.map((line) => `      ${line}`));
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
  // Kilo plugin context) is where commands run and what the payloads report.
  const pluginContextPattern = preambleLines.length > 0 ? "{ directory }" : "{ $ }";
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

  const preambleLines = buildRunHelperLines({
    handlers: [...Object.values(namedEventHandlers), ...Object.values(genericEventHandlers)].flat(),
    cwdExpression: V1_CWD_EXPRESSION,
  });

  const lines = wrapInExportShape({ preambleLines, bodyLines, exportStyle });

  return lines.join("\n");
}
