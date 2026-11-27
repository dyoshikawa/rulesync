// cspell:ignore nothrow setsid procfs lstart reparented subreaper taskkill -- Bun Shell API, POSIX, Windows
import { HooksConfig, stripControlChars } from "../../types/hooks.js";
import type { Logger } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { buildBlockReasonSanitizerLines } from "./hook-block-reason.js";
import { sanitizeMatcherRegex } from "./hook-matcher-regex.js";
import { capitalizedMatcherNames, replaceMatcherNames } from "./hook-matcher-tool-names.js";

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
export const SHELL_EVENT_TOOL_GATES: Record<string, { toolEvent: string; tool: string }> = {
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
export const BLOCKING_HOOKS: ReadonlySet<string> = new Set(
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
 * the programs the command starts: Bun Shell has no `unset`, so it exports an
 * empty value, which Bun treats as unset (only a non-empty value other than
 * `0` makes a Bun-compiled binary act as the Bun CLI). A host without the Bun
 * CLI fails the probe and falls back to Bun Shell, piping the payload into the
 * first command only (a probe still running after 10 s is killed; it, a
 * failing one or one that prints anything but `rulesync` means no Bun CLI for
 * 5 minutes). Ordinary commands write to the host's stdout and stderr, as Bun
 * Shell echoed them; a `preToolUse` command's are read, 1 MiB each kept (more
 * stdout denies; on the Bun Shell fallback the whole output is buffered before
 * that check), and a `sessionStart` command's stdout is read the same way while
 * its stderr goes to the host's (after the command, on Bun Shell). Output
 * pipes a background process keeps open are read for 1 s after the command
 * exits; what arrived by then is kept, and the reads are then cancelled, as
 * they are at a timeout. The OpenCode 1.x-style `event` hooks (`inProcess`)
 * take the Bun Shell path too: starting the child takes about
 * 250 ms, and OpenCode 1.x's one-shot `opencode run` exits right after
 * `session.idle`, before a `stop` command run that way could start.
 * A command that outlives its timeout (counted from its start) resolves to
 * `null` and is killed. On POSIX its process tree, read from procfs or else
 * `ps`, gets SIGTERM and, 2 s later, SIGKILL for each of those processes still
 * alive (same start time, wherever it was reparented) and what it started
 * since; the command's own process is signalled through its Bun handle only,
 * so a PID reused after it exited is never signalled. The command keeps
 * OpenCode's process group, so it keeps the terminal
 * and Ctrl-C, but a process that left the tree before the timeout (orphaned or
 * `setsid`) escapes, and without procfs and `ps` only
 * the command's own process is killed (logged). The pending SIGKILL keeps the
 * host alive for those 2 s. On Windows, `taskkill /T /F` ends the tree as
 * linked by parent PID at that moment, then the child is ended through its
 * handle; a process whose parent had already exited is not reached. Bun Shell
 * (the fallback) cannot kill: it stops waiting, and the command keeps running.
 * On a failure, `__rulesyncRunHook` throws in a blocking hook or logs it
 * otherwise.
 *
 * @see https://bun.sh/docs/bundler/executables
 */
function buildRunHelperLinesFor(cwdExpression: string): string[] {
  const spawn = (script: string, stdin: string, stdout = '"pipe"', stderr = stdout) =>
    `Bun.spawn([process.execPath, "--no-env-file", "exec", ${script}], { cwd: ${cwdExpression}, env: { ...process.env, BUN_BE_BUN: "1" }, stdin: ${stdin}, stdout: ${stdout}, stderr: ${stderr}, windowsHide: true })`;
  return [
    "const __rulesyncRead = (stream, limit = 1048576) => {",
    "  const chunks = [];",
    "  let size = 0;",
    "  const reader = stream.getReader();",
    "  let reading = true;",
    "  const done = (async () => {",
    "    for (let read; reading && !(read = await reader.read()).done; ) {",
    "      if (reading && (size += read.value.length) <= limit) chunks.push(read.value);",
    "    }",
    "  })().catch(() => {});",
    "  const stop = () => {",
    "    if (reading) (reading = false), reader.cancel().catch(() => {});",
    "  };",
    "  return { done, stop, text: () => Buffer.concat(chunks).toString(), overflow: () => size > limit };",
    "};",
    "let __rulesyncCanExec;",
    "let __rulesyncRetryAt = 0;",
    "// pid -> [ppid, start time], from procfs or else ps; a reused PID gets a new start time.",
    "const __rulesyncProcesses = () => {",
    "  const processes = new Map();",
    "  try {",
    '    const fs = require("node:fs");',
    '    for (const pid of fs.readdirSync("/proc").filter((name) => /^\\d+$/.test(name))) {',
    "      try {",
    '        const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");',
    '        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");',
    "        processes.set(pid, [fields[1], fields[19]]);",
    "      } catch {}",
    "    }",
    "    if (processes.size > 0) return processes;",
    "  } catch {}",
    "  try {",
    "    // The C locale keeps `lstart` in one format; it is compared as text, never parsed.",
    '    const env = { ...process.env, LC_ALL: "C", LANG: "C" };',
    '    const ps = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,lstart="], { env, timeout: 5000 });',
    "    if (ps.exitCode === 0) {",
    '      for (const line of ps.stdout.toString().trim().split("\\n")) {',
    "        const [pid, ppid, ...started] = line.trim().split(/\\s+/);",
    '        processes.set(pid, [ppid, started.join(" ")]);',
    "      }",
    "      return processes;",
    "    }",
    "  } catch {}",
    '  console.error("[rulesync-hooks] neither /proc nor ps is available: only the hook process is killed");',
    "};",
    "const __rulesyncTree = (roots, processes) => {",
    "  const tree = [...roots];",
    "  for (let size = -1; size !== tree.length; ) {",
    "    size = tree.length;",
    "    for (const [pid, [ppid]] of processes ?? []) if (tree.includes(ppid) && !tree.includes(pid)) tree.push(pid);",
    "  }",
    "  return tree;",
    "};",
    "// The child itself is signalled only through its handle, a no-op once Bun has reaped it, so a",
    "// reused PID is never signalled; its descendants only while it is running (not reaped, its PID",
    "// cannot be reused), and in the SIGKILL round only with both snapshots: the first snapshot's",
    "// descendants that are the same processes (same start time), and what they and the child,",
    "// if it ran across the second snapshot, have started since.",
    "const __rulesyncKillTree = (proc) => {",
    "  const kill = (pids, signal) => pids.forEach((pid) => { try { process.kill(Number(pid), signal); } catch {} });",
    "  const running = () => proc.exitCode === null && proc.signalCode === null;",
    "  const root = String(proc.pid);",
    "  const before = running() ? __rulesyncProcesses() : undefined;",
    "  const first = before && running() ? __rulesyncTree([root], before).slice(1) : [];",
    '  proc.kill("SIGTERM");',
    '  kill(first, "SIGTERM");',
    "  setTimeout(() => {",
    "    const alive = running();",
    "    const now = before && __rulesyncProcesses();",
    '    if (!now) return proc.kill("SIGKILL");',
    "    // Every first-snapshot descendant that is still the same process, wherever it was",
    "    // reparented (to PID 1 or a subreaper), and the child if it survived SIGTERM, with what",
    "    // they have started since. The child is killed first, so it starts nothing more.",
    "    const same = first.filter((pid) => now.get(pid)?.[1] === before.get(pid)?.[1]);",
    "    const own = alive && running() && now.get(root)?.[1] === before.get(root)?.[1];",
    '    proc.kill("SIGKILL");',
    '    kill(__rulesyncTree(own ? [root, ...same] : same, now).filter((pid) => pid !== root), "SIGKILL");',
    "  }, 2000);",
    "};",
    "// `proc.kill()` is TerminateProcess on the child alone. A libuv program (node) that dies takes",
    "// the children it spawned along through its job object, but not ones started through another",
    "// program (cmd.exe) or detached. taskkill /T ends the tree as linked by parent PID at that",
    "// moment; System32's copy, so a taskkill earlier on PATH is never run.",
    "const __rulesyncKillWindowsTree = (proc) => {",
    "  if (proc.exitCode === null && proc.signalCode === null) {",
    '    const taskkill = (process.env.SystemRoot ?? "C:\\\\Windows") + "\\\\System32\\\\taskkill.exe";',
    "    try {",
    '      Bun.spawnSync([taskkill, "/T", "/F", "/PID", String(proc.pid)], { stdout: "ignore", stderr: "ignore", windowsHide: true, timeout: 5000 });',
    "    } catch {}",
    "  }",
    "  proc.kill();",
    "};",
    "const __rulesyncRunCommand = async ({ command, input, seconds, inProcess = false, echo = false }) => {",
    "  // A probe that printed `rulesync` is kept; one past its deadline, failing or printing",
    "  // anything else means no Bun CLI for 5 minutes; one that threw is dropped, so the next",
    "  // command probes again.",
    "  if (!inProcess && (__rulesyncCanExec === undefined || (__rulesyncRetryAt && Date.now() >= __rulesyncRetryAt))) {",
    "    __rulesyncRetryAt = 0;",
    "    const probing = (__rulesyncCanExec = (async () => {",
    `      const probe = ${spawn('"echo rulesync"', '"ignore"', '"pipe"', '"ignore"')};`,
    "      const output = __rulesyncRead(probe.stdout, 1024);",
    "      let timer;",
    "      // Settles on its own, even if the probe ignores the kill or a process holds its stdout.",
    "      const deadline = new Promise((resolve) => (timer = setTimeout(resolve, 10000, null)));",
    "      const exited = Promise.all([probe.exited, output.done]).then(([code]) => code);",
    "      const exitCode = await Promise.race([exited, deadline]).finally(() => clearTimeout(timer));",
    '      if (exitCode === null) probe.kill("SIGKILL"), output.stop();',
    '      const found = exitCode === 0 && output.text().trim() === "rulesync";',
    "      if (!found) __rulesyncRetryAt = Date.now() + 300000;",
    "      return found;",
    "    })().catch(() => {",
    "      if (__rulesyncCanExec === probing) __rulesyncCanExec = undefined;",
    "      return false;",
    "    }));",
    "  }",
    "  let timer;",
    "  const timeout = () => new Promise((resolve) => (timer = setTimeout(resolve, seconds * 1000, null)));",
    "  if (inProcess || !(await __rulesyncCanExec)) {",
    `    const run = Bun.$\`echo \${input} | \${{ raw: command }}\`.cwd(${cwdExpression}).nothrow();`,
    "    // A sessionStart command's stderr reaches the host when it ends, even after its timeout.",
    "    const finished = echo === true ? run : run.quiet().then((done) => (echo && process.stderr.write(done.stderr), done));",
    "    const result = await Promise.race([finished, timeout()]).finally(() => clearTimeout(timer));",
    "    if (!result || echo === true) return result && { exitCode: result.exitCode };",
    "    const { exitCode, stdout, stderr } = result;",
    "    return { exitCode, stdout: stdout.toString(), stderr: stderr.toString(), overflow: stdout.length > 1048576 };",
    "  }",
    "  // An ordinary command writes to the host's stdout and stderr; a preToolUse one is read, and",
    '  // a sessionStart one (`echo: "stderr"`) has its stdout read.',
    `  const proc = ${spawn('"export BUN_BE_BUN=\\n" + command', 'new TextEncoder().encode(input + "\\n")', 'echo === true ? "inherit" : "pipe"', 'echo ? "inherit" : "pipe"')};`,
    "  const stdout = echo === true ? undefined : __rulesyncRead(proc.stdout);",
    "  const stderr = echo ? undefined : __rulesyncRead(proc.stderr);",
    "  const exitCode = await Promise.race([proc.exited, timeout()]).finally(() => clearTimeout(timer));",
    "  if (exitCode === null) {",
    "    stdout?.stop(), stderr?.stop();",
    '    if (process.platform === "win32") __rulesyncKillWindowsTree(proc);',
    "    else __rulesyncKillTree(proc);",
    "    return null;",
    "  }",
    "  if (echo === true) return { exitCode };",
    "  await Promise.race([Promise.all([stdout.done, stderr?.done]), Bun.sleep(1000)]);",
    "  stdout.stop(), stderr?.stop();",
    '  return { exitCode, stdout: stdout.text(), stderr: stderr?.text() ?? "", overflow: stdout.overflow() };',
    "};",
    "const __rulesyncRunHook = async ({ label, command, input, blocking, seconds, inProcess = false, context = false }) => {",
    "  let result;",
    "  try {",
    '    result = await __rulesyncRunCommand({ command, input, seconds, inProcess, echo: context ? "stderr" : true });',
    "  } catch (error) {",
    "    if (blocking) throw error;",
    '    console.error("[rulesync-hooks] " + label + " hook failed:", error);',
    "    return;",
    "  }",
    "  if (result === null) {",
    '    const message = "[rulesync-hooks] " + label + " hook timed out after " + seconds + "s";',
    "    if (blocking) throw new Error(message);",
    "    return console.error(message);",
    "  }",
    "  if (result.exitCode === 0) return result;",
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
 *   is `"deny"` → deny, with `permissionDecisionReason` as the reason; when it
 *   sets no `permissionDecision`, the deprecated top-level `decision: "block"`
 *   that Claude Code still honors denies too, with `reason` as the reason;
 * - exit code 0 otherwise → allow;
 * - any other non-zero exit → deny too, with stderr or the exit code;
 * - more than 1 MiB of stdout → deny, without parsing it;
 * - a command past its timeout → deny, like a non-zero exit, unless the hook
 *   sets `failClosed: false`, which allows the call and logs the timeout.
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
  `const ${PRE_TOOL_USE_RESULT_HELPER} = (result, failClosed) => {`,
  "  if (result === null) {",
  '    if (failClosed !== false) throw new Error("preToolUse hook timed out.");',
  '    return console.error("[rulesync-hooks] preToolUse hook timed out");',
  "  }",
  '  if (result.overflow) throw new Error("preToolUse hook wrote more than 1 MiB to stdout.");',
  "  const stderr = result.stderr.toString();",
  "  if (result.exitCode === 0) {",
  "    let parsed;",
  "    try {",
  "      parsed = JSON.parse(result.stdout.toString());",
  "    } catch {",
  "      return;",
  "    }",
  '    if (!parsed || typeof parsed !== "object") return;',
  "    const specific = parsed.hookSpecificOutput;",
  '    const hasDecision = typeof specific === "object" && specific !== null && specific.permissionDecision !== undefined;',
  "    const reason = hasDecision ? specific.permissionDecisionReason : parsed.reason;",
  '    if (hasDecision ? specific.permissionDecision === "deny" : parsed.decision === "block") {',
  "      throw new Error(",
  '        (typeof reason === "string" && sanitizeBlockReason(reason)) || "Blocked by a preToolUse hook.",',
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

/**
 * Helpers the generated plugin defines when a `sessionStart` handler is
 * present, so the command's stdout reaches the model as Claude Code's
 * `SessionStart` stdout does:
 * - `__rulesyncSessionStart(sessionID, run)` runs a session's `sessionStart`
 *   commands (`run` pushes each command's result) and keeps the pending context
 *   for that session. It always settles, since every command is bounded by its
 *   timeout.
 * - `__rulesyncSessionContext(sessionID)` waits for that context, which the
 *   host's system-prompt hook then adds to each model request of the session.
 *
 * A command's context is its stdout on exit code 0, or the
 * `hookSpecificOutput.additionalContext` string of a JSON object it prints,
 * trimmed and capped at Claude Code's 10,000 characters; more than 1 MiB of
 * stdout is logged and ignored. Only sessions whose context is not empty are
 * kept, the 100 whose context was used or became ready most recently, and a
 * deleted session is dropped.
 */
const SESSION_CONTEXT_HELPER_LINES: readonly string[] = [
  "const __rulesyncSessionContexts = new Map();",
  "const __rulesyncKept = new WeakSet();",
  "const __rulesyncContextOf = (result) => {",
  '  if (typeof result?.stdout !== "string") return "";',
  "  if (result.overflow) {",
  '    console.error("[rulesync-hooks] sessionStart hook wrote more than 1 MiB to stdout; it is ignored");',
  '    return "";',
  "  }",
  "  let text = result.stdout;",
  "  try {",
  "    const parsed = JSON.parse(text);",
  "    // Like Claude Code, only a JSON object counts as JSON output; anything else is plain text.",
  '    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) text = parsed.hookSpecificOutput?.additionalContext;',
  "  } catch {}",
  '  return typeof text === "string" ? text.trim().slice(0, 10000) : "";',
  "};",
  "const __rulesyncSessionStart = (sessionID, run) => {",
  "  const results = [];",
  "  const pending = run(results)",
  "    .catch(() => {})",
  '    .then(() => results.map(__rulesyncContextOf).filter(Boolean).join("\\n\\n"));',
  '  if (typeof sessionID === "string") {',
  "    __rulesyncSessionContexts.delete(sessionID);",
  "    __rulesyncSessionContexts.set(sessionID, pending);",
  "    // Only a non-empty context is kept, and only it counts towards the 100: a running",
  "    // or empty one never evicts another session's context.",
  "    pending.then((context) => {",
  "      if (__rulesyncSessionContexts.get(sessionID) !== pending) return;",
  "      if (!context) return void __rulesyncSessionContexts.delete(sessionID);",
  "      __rulesyncKept.add(pending);",
  "      // Evict in completion order: a context counts as used once it is ready.",
  "      __rulesyncSessionContexts.delete(sessionID);",
  "      __rulesyncSessionContexts.set(sessionID, pending);",
  "      const kept = [...__rulesyncSessionContexts].filter(([, entry]) => __rulesyncKept.has(entry));",
  "      if (kept.length > 100) __rulesyncSessionContexts.delete(kept[0][0]);",
  "    });",
  "  }",
  "  return pending;",
  "};",
  "const __rulesyncSessionContext = async (sessionID) => {",
  "  const pending = __rulesyncSessionContexts.get(sessionID);",
  '  if (!pending) return "";',
  "  __rulesyncSessionContexts.delete(sessionID);",
  "  __rulesyncSessionContexts.set(sessionID, pending);",
  "  return pending;",
  "};",
];

/**
 * The statements of a `sessionStart` group, run through `__rulesyncSessionStart`.
 * `__rulesyncSessionStart` registers the session's pending context before its
 * first `await`, so `"void"` (used by the serial V2 event loop) registers it
 * as soon as the event is read without waiting for the commands.
 */
export function wrapSessionStartLines(
  sessionIdExpression: string,
  statements: string[],
  operator: "await" | "void" = "await",
): string[] {
  return [
    `${operator} __rulesyncSessionStart(${sessionIdExpression}, async (__rulesyncResults) => {`,
    ...statements.map((line) => `  ${line}`),
    "});",
  ];
}

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
  timeout: number;
  /** Unset and `true` deny a timed-out `preToolUse` call; only `false` allows it. */
  failClosed: boolean | undefined;
  payload?: StdinPayload;
  /** A `sessionStart` handler, whose stdout becomes the session's model context. */
  context?: boolean;
};

/**
 * A hook's `timeout` in seconds, Claude Code's default of 600 when it sets none,
 * capped at what `setTimeout` can wait (larger values fire at once), and its
 * `failClosed` as written: unset is not `false`.
 */
export function hookTimingOf(def: { timeout?: number; failClosed?: boolean }) {
  const timeout = def.timeout !== undefined && def.timeout > 0 ? def.timeout : 600;
  return { timeout: Math.min(timeout, 2_147_483), failClosed: def.failClosed };
}

const FAIL_CLOSED_TOOL_LABELS = {
  kilo: "Kilo Code",
  mimocode: "MiMo Code",
  opencode: "OpenCode",
  opencodev1: "OpenCode V1",
} as const;

/**
 * Canonical events other than `preToolUse` whose hook runs before its action in
 * every OpenCode-style plugin (V1 and V2): a failing or timed-out command always
 * aborts the action there. A test checks it against `BLOCKING_HOOKS` and the V2
 * generator's `isBlockingOpencodeV2Target`.
 */
export const ALWAYS_BLOCKING_EVENTS: ReadonlySet<string> = new Set([
  "beforeShellExecution",
  "beforeSubmitPrompt",
  "preModelInvocation",
  "userPromptExpansion",
  "preCompact",
]);

/**
 * Warn about each `failClosed` the generated plugin ignores where it changes
 * the outcome: the plugin only reads it on `preToolUse`, to decide what a
 * timed-out command does. Elsewhere a hook that runs before its action always
 * fails on a timeout, so a `false` there is ignored (a `true` already holds),
 * and any other hook only logs it, so a `true` there is ignored (a `false`
 * already holds, like the other targets treat an omitted `false`).
 */
export function warnIgnoredFailClosed({
  config,
  supportedEvents,
  toolConfigKey,
  logger,
}: {
  config: HooksConfig;
  supportedEvents: readonly string[];
  toolConfigKey: keyof typeof FAIL_CLOSED_TOOL_LABELS;
  logger?: Logger;
}): void {
  const configHooks = { ...config.hooks, ...config[toolConfigKey]?.hooks };
  const plugin = `the generated ${FAIL_CLOSED_TOOL_LABELS[toolConfigKey]} plugin`;
  for (const [event, definitions] of Object.entries(configHooks)) {
    if (event === "preToolUse" || !supportedEvents.includes(event)) continue;
    const blocking = ALWAYS_BLOCKING_EVENTS.has(event);
    for (const def of definitions) {
      if (def.failClosed !== !blocking) continue;
      logger?.warn(
        blocking
          ? `failClosed: false on "${event}" hook will be ignored — ${plugin} always blocks the action when this hook fails or times out, and only supports failClosed on preToolUse`
          : `failClosed on "${event}" hook will be ignored — ${plugin} only supports failClosed on preToolUse`,
      );
    }
  }
}

/**
 * Canonical (Claude Code) tool names mapped to the lowercase tool ids OpenCode
 * 1.x and its forks (Kilo, MiMo Code) pass as `input.tool`, which a matcher is
 * tested against case-sensitively. The shell tool is `bash` here, the same id
 * the shell events gate on (see {@link SHELL_EVENT_TOOL_GATES}).
 * @see https://opencode.ai/docs/plugins/
 */
const CANONICAL_TO_OPENCODE_V1_TOOL_NAMES: Readonly<Record<string, string>> = {
  Bash: "bash",
  Read: "read",
  Write: "write",
  Edit: "edit",
};

/**
 * A matcher made only of plain names joined by `|`, which Claude Code matches
 * as an exact tool name list rather than as a regex.
 */
const PLAIN_NAME_MATCHER_PATTERN = /^[A-Za-z0-9_]+(?:\|[A-Za-z0-9_]+)*$/;

/** Translates one matcher of one canonical event to the tool's names. */
export type OpencodeMatcherTranslator = (matcher: string, eventName: string) => string;

/**
 * Build a translator that rewrites the canonical tool names in a matcher
 * through `toolNames` and warns about a capitalized name left over
 * (`MultiEdit`, `Glob`), which no lowercase tool id can match. Each distinct
 * matcher of an event is translated once, so hooks sharing one do not repeat
 * its warning.
 *
 * The plugins test the matcher unanchored, so a translated plain-name matcher
 * is anchored as `^(?:...)$` to keep Claude Code's exact-name semantics:
 * otherwise `write` would also match OpenCode's `todowrite`. Regex-style and
 * untranslated matchers are left as written.
 */
export function createOpencodeMatcherTranslator({
  toolNames,
  toolConfigKey,
  logger,
}: {
  toolNames: Readonly<Record<string, string>>;
  toolConfigKey: keyof typeof FAIL_CLOSED_TOOL_LABELS;
  logger?: Logger;
}): OpencodeMatcherTranslator {
  const label = FAIL_CLOSED_TOOL_LABELS[toolConfigKey];
  const translated = new Map<string, string>();
  return (matcher, eventName) => {
    const key = `${eventName}\0${matcher}`;
    const cached = translated.get(key);
    if (cached !== undefined) return cached;
    const replaced = replaceMatcherNames(matcher, toolNames);
    const result =
      replaced !== matcher && PLAIN_NAME_MATCHER_PATTERN.test(stripControlChars(matcher))
        ? `^(?:${replaced})$`
        : replaced;
    const unmatched = capitalizedMatcherNames(result);
    if (unmatched.length > 0) {
      logger?.warn(
        `${label} matches hook matchers case-sensitively against lowercase tool names, and ` +
          `${unmatched.map((name) => quoteValueForWarning(name)).join(", ")} in the ` +
          `${quoteValueForWarning(eventName)} matcher ${quoteValueForWarning(matcher)} is not translated by ` +
          `rulesync, so it is written as-is and will likely never match. Use the tool name ` +
          `${label} reports instead.`,
      );
    }
    translated.set(key, result);
    return result;
  };
}

type Handler = RunnableHandler & {
  matcher?: string;
  toolGate?: string;
  propertyGate?: string;
};
type HandlerGroup = Record<string, Handler[]>;

/** Whether any handler is a `sessionStart` one, whose stdout becomes session context. */
export function usesSessionContext(handlers: ReadonlyArray<{ context?: boolean }>): boolean {
  return handlers.some((handler) => handler.context);
}

/** The handler fields a canonical event's `sessionStart`-ness adds. */
export function sessionContextExtrasFor(canonicalEvent: string): { context?: true } {
  return canonicalEvent === "sessionStart" ? { context: true } : {};
}

/** The per-canonical-event gates and payload every handler of it carries. */
function handlerExtrasFor(
  canonicalEvent: string,
): Pick<Handler, "event" | "toolGate" | "propertyGate" | "payload" | "context"> {
  const shellGate = SHELL_EVENT_TOOL_GATES[canonicalEvent];
  const propertyGate = GENERIC_EVENT_PROPERTY_GATES[canonicalEvent];
  const payload = shellGate ? undefined : STDIN_PAYLOADS[canonicalEvent];
  return {
    event: canonicalEvent,
    ...(shellGate ? { toolGate: shellGate.tool } : {}),
    ...(propertyGate ? { propertyGate } : {}),
    ...(payload ? { payload } : {}),
    ...sessionContextExtrasFor(canonicalEvent),
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
  translateMatcher,
}: {
  effectiveHooks: HooksConfig["hooks"];
  eventMap: Record<string, string>;
  namedEventHandlers: HandlerGroup;
  genericEventHandlers: HandlerGroup;
  translateMatcher: OpencodeMatcherTranslator;
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
    // Only a matcher tested against the tool id names tools; the
    // `command.execute.before` one names a slash command and stays as written.
    const matchesToolName = NAMED_HOOK_MATCHER_SUBJECTS[toolEvent] === "input.tool";

    const handlers: Handler[] = [];
    for (const def of definitions) {
      if ((def.type ?? "command") !== "command") continue;
      if (!def.command) continue;
      if (def.matcher && !matcherSupported) continue;
      handlers.push({
        command: def.command,
        matcher: def.matcher
          ? matchesToolName
            ? translateMatcher(def.matcher, canonicalEvent)
            : def.matcher
          : undefined,
        blocking: BLOCKING_HOOKS.has(toolEvent),
        ...hookTimingOf(def),
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
  const usesContext = Object.values(genericEventHandlers).some(usesSessionContext);
  if (usesContext) {
    bodyLines.push(
      `      if (event.type === "session.deleted") __rulesyncSessionContexts.delete(${V1_SESSION_ID_EXPRESSION});`,
    );
  }
  let isFirst = true;
  for (const [eventName, handlers] of Object.entries(genericEventHandlers)) {
    bodyLines.push(`      ${isFirst ? "if" : "else if"} (event.type === "${eventName}") {`);
    isFirst = false;
    const statements = buildPayloadClosureLines({ handlers, cwdExpression: V1_CWD_EXPRESSION });
    for (const handler of handlers) {
      const runStatement = buildRunStatement(handler);
      if (handler.propertyGate) {
        // The dispatch fires more broadly than the canonical event it came
        // from, so this handler narrows it to the matching payload.
        statements.push(`if (${handler.propertyGate}) {`, `  ${runStatement}`, "}");
      } else {
        statements.push(runStatement);
      }
    }
    const lines = usesSessionContext(handlers)
      ? wrapSessionStartLines(V1_SESSION_ID_EXPRESSION, statements)
      : statements;
    bodyLines.push(...lines.map((line) => `        ${line}`));
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

/** The session a V1 `session.created` / `session.deleted` event is about. */
const V1_SESSION_ID_EXPRESSION = "event.properties?.info?.id";

/**
 * The V1 named hook that adds a session's `sessionStart` context to the system
 * prompt of each of its model requests. OpenCode 1.x, Kilo and MiMo Code all
 * call it with the request's `sessionID`.
 */
const V1_SYSTEM_TRANSFORM_LINES: readonly string[] = [
  '    "experimental.chat.system.transform": async (input, output) => {',
  "      const context = await __rulesyncSessionContext(input?.sessionID);",
  "      if (context && Array.isArray(output?.system)) output.system.push(context);",
  "    },",
];

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
 * A handler's command and stdin expressions as the run helpers take them. The
 * command keeps the escaping it had in the template literal earlier versions
 * emitted, so `bun exec` parses the same text.
 */
export function commandAndInputOf(handler: RunnableHandler): { command: string; input: string } {
  return {
    command: JSON.stringify(escapeForTemplateLiteral(handler.command)),
    input: handler.payload ? `${stdinPayloadVariable(handler.payload.name)}()` : '""',
  };
}

/**
 * The statement that runs a handler's command with its stdin payload, or an
 * empty stdin (see `commandAndInputOf`).
 */
export function buildRunStatement(handler: RunnableHandler): string {
  const { command, input } = commandAndInputOf(handler);
  if (handler.payload?.name === "PreToolUse") {
    // An unset `failClosed` is left out: the helper denies on a timeout unless it is `false`.
    const failClosed = handler.failClosed === undefined ? "" : `, ${handler.failClosed}`;
    return `${PRE_TOOL_USE_RESULT_HELPER}(await __rulesyncRunCommand({ command: ${command}, input: ${input}, seconds: ${handler.timeout} })${failClosed});`;
  }
  const options = [
    `label: ${JSON.stringify(handler.event)}`,
    `command: ${command}`,
    `input: ${input}`,
    `blocking: ${handler.blocking}`,
    `seconds: ${handler.timeout}`,
    ...(handler.inProcess ? ["inProcess: true"] : []),
    ...(handler.context ? ["context: true"] : []),
  ];
  const run = `await __rulesyncRunHook({ ${options.join(", ")} })`;
  return handler.context ? `__rulesyncResults.push(${run});` : `${run};`;
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
  const usesContext = usesSessionContext(handlers);
  return [
    ...buildRunHelperLinesFor(cwdExpression),
    ...(usesPreToolUse ? ["", ...PRE_TOOL_USE_RESULT_HELPER_LINES] : []),
    ...(usesContext ? ["", ...SESSION_CONTEXT_HELPER_LINES] : []),
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
  logger?: Logger,
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
    translateMatcher: createOpencodeMatcherTranslator({
      toolNames: CANONICAL_TO_OPENCODE_V1_TOOL_NAMES,
      toolConfigKey,
      logger,
    }),
  });

  // Build the handler entries (the contents of the returned object) once with a
  // base indentation, then wrap them in the requested export shape. The default
  // (Kilo) export nests the function one level deeper, so its body is re-indented
  // by an extra two spaces relative to the named (OpenCode) export.
  const usesContext = Object.values(genericEventHandlers).some(usesSessionContext);
  const bodyLines: string[] = [
    ...buildGenericEventBodyLines(genericEventHandlers),
    ...buildNamedEventBodyLines(namedEventHandlers),
    ...(usesContext ? V1_SYSTEM_TRANSFORM_LINES : []),
  ];

  const preambleLines = buildRunHelperLines({
    handlers: [...Object.values(namedEventHandlers), ...Object.values(genericEventHandlers)].flat(),
    cwdExpression: V1_CWD_EXPRESSION,
  });

  const lines = wrapInExportShape({ preambleLines, bodyLines, exportStyle });

  return lines.join("\n");
}
